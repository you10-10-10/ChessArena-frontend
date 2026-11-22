import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

function getErrorDetails(error: unknown) {
  if (typeof error !== 'object' || error === null) {
    return { code: undefined, message: error instanceof Error ? error.message : 'Unknown error' };
  }
  const details = error as Record<string, unknown>;
  return {
    code: typeof details.code === 'string' ? details.code : undefined,
    message: typeof details.message === 'string' ? details.message : 'Unknown error',
  };
}

function isAdminConfigurationError(error: unknown) {
  return error instanceof Error && error.name === 'SupabaseAdminConfigurationError';
}

export async function GET() {
  let userId: string | null = null;
  let stage = 'authenticate';
  try {
    const supabase = await createServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    userId = user.id;

    // Fetch received pending invitations
    stage = 'load_received_invitations';
    const { data: received, error: receivedError } = await supabase
      .from('game_invitations')
      .select(`
        id, sender_id, receiver_id, game_mode, time_control, selected_color, status, game_id, expires_at, created_at, updated_at,
        sender:profiles!game_invitations_sender_id_fkey(id, username, full_name, avatar_url, rating)
      `)
      .eq('receiver_id', user.id)
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false });

    if (receivedError) throw receivedError;

    // Fetch sent pending invitations
    stage = 'load_sent_invitations';
    const { data: sent, error: sentError } = await supabase
      .from('game_invitations')
      .select(`
        id, sender_id, receiver_id, game_mode, time_control, selected_color, status, game_id, expires_at, created_at, updated_at,
        receiver:profiles!game_invitations_receiver_id_fkey(id, username, full_name, avatar_url, rating)
      `)
      .eq('sender_id', user.id)
      .in('status', ['pending', 'accepted'])
      .or(`status.eq.accepted,expires_at.gt.${new Date().toISOString()}`)
      .order('created_at', { ascending: false });

    if (sentError) throw sentError;

    return NextResponse.json({ received: received || [], sent: sent || [] });
  } catch (error) {
    console.error('Fetch game invitations error:', {
      endpoint: '/api/invitations',
      userId,
      stage,
      ...getErrorDetails(error),
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to load invitations' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  let userId: string | null = null;
  let stage = 'authenticate';
  try {
    const supabase = await createServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    userId = user.id;

    stage = 'parse_request';
    const body = await request.json();
    const { recipientUsername, gameMode = 'standard', timeControl = '3+2', selectedColor = 'random' } = body;

    if (!recipientUsername || typeof recipientUsername !== 'string') {
      return NextResponse.json({ error: 'Recipient username is required' }, { status: 400 });
    }

    stage = 'send_invitation_rpc';
    const { data, error } = await supabase.rpc('send_game_invitation', {
      p_recipient_username: recipientUsername.trim(),
      p_game_mode: gameMode,
      p_time_control: timeControl,
      p_selected_color: selectedColor,
    });

    if (error) {
      console.error('Send game invitation RPC failed:', {
        endpoint: '/api/invitations',
        userId,
        stage,
        ...getErrorDetails(error),
      });
      stage = 'fallback_invitation_write';
      let admin: ReturnType<typeof createAdminClient>;
      try {
        admin = createAdminClient();
      } catch (adminError) {
        if (isAdminConfigurationError(adminError)) {
          console.error('Invitation fallback is not configured:', {
            endpoint: '/api/invitations',
            userId,
            stage,
            ...getErrorDetails(adminError),
          });
          return NextResponse.json(
            { error: 'Invitation fallback is not configured. Set SUPABASE_SERVICE_KEY as a private server environment variable.' },
            { status: 503 },
          );
        }
        throw adminError;
      }
      const { data: recipient, error: recipientError } = await admin
        .from('profiles')
        .select('id')
        .ilike('username', recipientUsername.trim())
        .maybeSingle();
      if (recipientError || !recipient) {
        throw new Error('Player not found');
      }
      if (recipient.id === user.id) {
        throw new Error('You cannot invite yourself');
      }
      const { data: existing } = await admin
        .from('game_invitations')
        .select('id')
        .eq('status', 'pending')
        .or(`and(sender_id.eq.${user.id},receiver_id.eq.${recipient.id}),and(sender_id.eq.${recipient.id},receiver_id.eq.${user.id})`)
        .gt('expires_at', new Date().toISOString())
        .limit(1);
      if (existing && existing.length > 0) {
        throw new Error('An active invitation already exists between you and this player');
      }
      const { data: inserted, error: insertError } = await admin
        .from('game_invitations')
        .insert({
          sender_id: user.id,
          receiver_id: recipient.id,
          game_mode: gameMode,
          time_control: timeControl,
          selected_color: selectedColor,
          status: 'pending',
          expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        })
        .select('id')
        .single();
      if (insertError) throw insertError;
      return NextResponse.json({ status: 'invited', invitationId: inserted.id, fallback: true });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Send game invitation error:', {
      endpoint: '/api/invitations',
      userId,
      stage,
      ...getErrorDetails(error),
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to send invitation' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  let invitationId: string | null = null;
  let userId: string | null = null;
  let stage = 'authenticate';
  try {
    const supabase = await createServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    userId = user.id;

    stage = 'parse_request';
    const body: unknown = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 });
    }
    const requestBody = body as { invitationId?: unknown; action?: unknown };
    invitationId = typeof requestBody.invitationId === 'string' ? requestBody.invitationId : null;
    const action = requestBody.action;

    if (!invitationId || typeof action !== 'string' || !['accept', 'decline', 'cancel'].includes(action)) {
      return NextResponse.json({ error: 'Valid invitation ID and action required' }, { status: 400 });
    }

    stage = 'respond_game_invitation_rpc';
    const { data, error } = await supabase.rpc('respond_game_invitation', {
      p_invitation_id: invitationId,
      p_action: action,
    });

    if (error) {
      console.error('Respond game invitation RPC failed:', {
        endpoint: '/api/invitations',
        invitationId,
        userId,
        stage,
        ...getErrorDetails(error),
      });
      stage = 'fallback_invitation_response';
    }

    if (!error && action === 'accept' && data && typeof data === 'object' &&
        !Array.isArray(data) && 'status' in data && data.status === 'expired') {
      return NextResponse.json({ error: 'This invitation has expired.' }, { status: 410 });
    }

    if (error) {
      let admin: ReturnType<typeof createAdminClient>;
      try {
        admin = createAdminClient();
      } catch (adminError) {
        if (isAdminConfigurationError(adminError)) {
          console.error('Invitation response fallback is not configured:', {
            endpoint: '/api/invitations',
            invitationId,
            userId,
            stage,
            ...getErrorDetails(adminError),
          });
          return NextResponse.json(
            { error: 'Invitation fallback is not configured. Set SUPABASE_SERVICE_KEY as a private server environment variable.' },
            { status: 503 },
          );
        }
        throw adminError;
      }
      const { data: invitation, error: invitationError } = await admin
        .from('game_invitations')
        .select('*')
        .eq('id', invitationId)
        .maybeSingle();
      if (invitationError || !invitation) throw new Error('Invitation not found');

      if (action === 'cancel' && invitation.sender_id !== user.id) {
        return NextResponse.json({ error: 'Only the sender can cancel this invitation.' }, { status: 403 });
      }
      if ((action === 'accept' || action === 'decline') && invitation.receiver_id !== user.id) {
        return NextResponse.json({ error: 'Only the recipient can respond to this invitation.' }, { status: 403 });
      }
      if (action === 'accept' && invitation.status === 'accepted' && invitation.game_id) {
        return NextResponse.json({ status: 'accepted', gameId: invitation.game_id });
      }
      if (invitation.status === 'pending' && new Date(invitation.expires_at).getTime() <= Date.now()) {
        const { error: expireError } = await admin
          .from('game_invitations')
          .update({ status: 'expired', updated_at: new Date().toISOString() })
          .eq('id', invitationId)
          .eq('status', 'pending');
        if (expireError) throw expireError;
        return NextResponse.json({ error: 'This invitation has expired.' }, { status: 410 });
      }
      if (invitation.status !== 'pending') {
        return NextResponse.json({ error: 'Invitation is no longer pending.' }, { status: 409 });
      }

      if (action === 'cancel') {
        const { error: updateError } = await admin
          .from('game_invitations')
          .update({ status: 'cancelled', updated_at: new Date().toISOString() })
          .eq('id', invitationId)
          .eq('status', 'pending');
        if (updateError) throw updateError;
        return NextResponse.json({ status: 'cancelled', fallback: true });
      }
      if (action === 'decline') {
        const { error: updateError } = await admin
          .from('game_invitations')
          .update({ status: 'declined', updated_at: new Date().toISOString() })
          .eq('id', invitationId)
          .eq('status', 'pending');
        if (updateError) throw updateError;
        return NextResponse.json({ status: 'declined', fallback: true });
      }
      return NextResponse.json(
        { error: 'Invitation acceptance requires the atomic respond_game_invitation database function. Apply sql/game_invitations.sql.' },
        { status: 503 },
      );
    }

    if (action === 'accept' && data && typeof data === 'object' && !Array.isArray(data)) {
      const response = data as Record<string, unknown>;
      const gameId = typeof response.gameId === 'string'
        ? response.gameId
        : typeof response.game_id === 'string'
          ? response.game_id
          : null;
      if (gameId) {
        return NextResponse.json({ ...response, gameId });
      }

      let admin: ReturnType<typeof createAdminClient>;
      try {
        admin = createAdminClient();
      } catch (adminError) {
        if (isAdminConfigurationError(adminError)) {
          console.error('Accepted invitation game lookup is not configured:', {
            endpoint: '/api/invitations',
            invitationId,
            userId,
            stage: 'lookup_accepted_game_id',
            ...getErrorDetails(adminError),
          });
          return NextResponse.json(
            { error: 'Invitation lookup is not configured. Set SUPABASE_SERVICE_KEY as a private server environment variable.' },
            { status: 503 },
          );
        }
        throw adminError;
      }
      const { data: invitation, error: invitationError } = await admin
        .from('game_invitations')
        .select('game_id')
        .eq('id', invitationId)
        .eq('receiver_id', user.id)
        .maybeSingle();
      if (invitationError) {
        console.error('Accepted invitation game lookup failed:', {
          endpoint: '/api/invitations',
          invitationId,
          userId,
          stage: 'lookup_accepted_game_id',
          ...getErrorDetails(invitationError),
        });
        throw new Error('Invitation was accepted, but its game could not be loaded.');
      }
      if (typeof invitation?.game_id === 'string') {
        return NextResponse.json({ ...response, gameId: invitation.game_id });
      }
      return NextResponse.json(
        { error: 'Invitation was accepted, but the game ID was not returned.' },
        { status: 500 },
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Respond game invitation error:', {
      endpoint: '/api/invitations',
      invitationId,
      userId,
      stage,
      ...getErrorDetails(error),
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to process invitation action' },
      { status: 500 }
    );
  }
}
