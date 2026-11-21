import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET() {
  try {
    const supabase = await createServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    // Fetch received pending invitations
    const { data: received, error: receivedError } = await supabase
      .from('game_invitations')
      .select(`
        id, sender_id, receiver_id, game_mode, time_control, selected_color, status, game_id, expires_at, created_at,
        sender:profiles!game_invitations_sender_id_fkey(id, username, full_name, avatar_url, rating)
      `)
      .eq('receiver_id', user.id)
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false });

    if (receivedError) throw receivedError;

    // Fetch sent pending invitations
    const { data: sent, error: sentError } = await supabase
      .from('game_invitations')
      .select(`
        id, sender_id, receiver_id, game_mode, time_control, selected_color, status, game_id, expires_at, created_at,
        receiver:profiles!game_invitations_receiver_id_fkey(id, username, full_name, avatar_url, rating)
      `)
      .eq('sender_id', user.id)
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false });

    if (sentError) throw sentError;

    return NextResponse.json({ received: received || [], sent: sent || [] });
  } catch (error) {
    console.error('Fetch game invitations error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to load invitations' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const body = await request.json();
    const { recipientUsername, gameMode = 'standard', timeControl = '3+2', selectedColor = 'random' } = body;

    if (!recipientUsername || typeof recipientUsername !== 'string') {
      return NextResponse.json({ error: 'Recipient username is required' }, { status: 400 });
    }

    const { data, error } = await supabase.rpc('send_game_invitation', {
      p_recipient_username: recipientUsername.trim(),
      p_game_mode: gameMode,
      p_time_control: timeControl,
      p_selected_color: selectedColor,
    });

    if (error) {
      const admin = createAdminClient();
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
    console.error('Send game invitation error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to send invitation' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const supabase = await createServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const body = await request.json();
    const { invitationId, action } = body;

    if (!invitationId || !['accept', 'decline', 'cancel'].includes(action)) {
      return NextResponse.json({ error: 'Valid invitation ID and action required' }, { status: 400 });
    }

    const { data, error } = await supabase.rpc('respond_game_invitation', {
      p_invitation_id: invitationId,
      p_action: action,
    });

    if (error) {
      const admin = createAdminClient();
      const { data: invitation, error: invitationError } = await admin
        .from('game_invitations')
        .select('*')
        .eq('id', invitationId)
        .maybeSingle();
      if (invitationError || !invitation) throw new Error('Invitation not found');
      if (invitation.status !== 'pending') throw new Error('Invitation is no longer pending');

      if (action === 'cancel') {
        if (invitation.sender_id !== user.id) throw new Error('Only the sender can cancel this invitation');
        await admin.from('game_invitations').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', invitationId);
        return NextResponse.json({ status: 'cancelled', fallback: true });
      }
      if (action === 'decline') {
        if (invitation.receiver_id !== user.id) throw new Error('Only the recipient can decline this invitation');
        await admin.from('game_invitations').update({ status: 'declined', updated_at: new Date().toISOString() }).eq('id', invitationId);
        return NextResponse.json({ status: 'declined', fallback: true });
      }
      if (invitation.receiver_id !== user.id) throw new Error('Only the recipient can accept this invitation');

      let whiteId = invitation.sender_id;
      let blackId = invitation.receiver_id;
      if (invitation.selected_color === 'black') {
        whiteId = invitation.receiver_id;
        blackId = invitation.sender_id;
      } else if (invitation.selected_color === 'random' && Math.random() < 0.5) {
        whiteId = invitation.receiver_id;
        blackId = invitation.sender_id;
      }
      const { data: profiles } = await admin
        .from('profiles')
        .select('id, rating')
        .in('id', [whiteId, blackId]);
      const whiteRating = profiles?.find((profile) => profile.id === whiteId)?.rating ?? 1200;
      const blackRating = profiles?.find((profile) => profile.id === blackId)?.rating ?? 1200;
      const { data: game, error: gameError } = await admin
        .from('games')
        .insert({
          white_player_id: whiteId,
          black_player_id: blackId,
          white_rating: whiteRating,
          black_rating: blackRating,
          time_control: invitation.time_control,
          status: 'in_progress',
          result: 'in_progress',
          fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
          moves: [],
        })
        .select('id')
        .single();
      if (gameError) throw gameError;
      await admin.from('game_invitations').update({
        status: 'accepted',
        game_id: game.id,
        updated_at: new Date().toISOString(),
      }).eq('id', invitationId);
      return NextResponse.json({ status: 'accepted', gameId: game.id, fallback: true });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Respond game invitation error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to process invitation action' },
      { status: 500 }
    );
  }
}
