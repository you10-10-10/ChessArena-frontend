-- Fix game_invitations table RLS and SQL Functions
-- Run this in your Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS game_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  receiver_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  game_mode TEXT NOT NULL DEFAULT 'standard',
  time_control TEXT NOT NULL DEFAULT '3+2',
  selected_color TEXT NOT NULL DEFAULT 'random',
  status TEXT NOT NULL DEFAULT 'pending',
  game_id UUID REFERENCES games(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '10 minutes'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE game_invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Involved users read game invitations" ON game_invitations;
CREATE POLICY "Involved users read game invitations" ON game_invitations FOR SELECT
  USING (auth.uid() = sender_id OR auth.uid() = receiver_id);

REVOKE ALL ON game_invitations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON game_invitations TO authenticated;

-- Function: Send Game Invitation by Username
CREATE OR REPLACE FUNCTION public.send_game_invitation(
  p_recipient_username TEXT,
  p_game_mode TEXT DEFAULT 'standard',
  p_time_control TEXT DEFAULT '3+2',
  p_selected_color TEXT DEFAULT 'random'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  requesting_user UUID := auth.uid();
  target_user UUID;
  created_invitation_id UUID;
  existing_pending_id UUID;
BEGIN
  IF requesting_user IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_recipient_username IS NULL OR BTRIM(p_recipient_username) = '' THEN
    RAISE EXCEPTION 'Enter a valid username to invite';
  END IF;

  SELECT id INTO target_user
  FROM public.profiles
  WHERE lower(username) = lower(BTRIM(p_recipient_username));

  IF target_user IS NULL THEN
    RAISE EXCEPTION 'Player not found';
  END IF;

  IF target_user = requesting_user THEN
    RAISE EXCEPTION 'You cannot invite yourself';
  END IF;

  -- Expire old pending invites
  UPDATE public.game_invitations
  SET status = 'expired', updated_at = NOW()
  WHERE status = 'pending'
    AND expires_at < NOW();

  -- Check existing pending invite between these users
  SELECT id INTO existing_pending_id
  FROM public.game_invitations
  WHERE status = 'pending'
    AND (
      (sender_id = requesting_user AND receiver_id = target_user)
      OR
      (sender_id = target_user AND receiver_id = requesting_user)
    )
  LIMIT 1;

  IF existing_pending_id IS NOT NULL THEN
    RAISE EXCEPTION 'An active invitation already exists between you and this player';
  END IF;

  INSERT INTO public.game_invitations (
    sender_id, receiver_id, game_mode, time_control, selected_color, status, expires_at
  )
  VALUES (
    requesting_user, target_user, p_game_mode, p_time_control, p_selected_color, 'pending', NOW() + INTERVAL '10 minutes'
  )
  RETURNING id INTO created_invitation_id;

  RETURN jsonb_build_object(
    'status', 'invited',
    'invitationId', created_invitation_id
  );
END;
$$;

-- Function: Respond to Game Invitation
CREATE OR REPLACE FUNCTION public.respond_game_invitation(
  p_invitation_id UUID,
  p_action TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  requesting_user UUID := auth.uid();
  invitation public.game_invitations%ROWTYPE;
  white_id UUID;
  black_id UUID;
  white_rating_val INTEGER;
  black_rating_val INTEGER;
  new_game_id UUID;
BEGIN
  IF requesting_user IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO invitation
  FROM public.game_invitations
  WHERE id = p_invitation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found';
  END IF;

  IF invitation.status = 'accepted'
    AND p_action = 'accept'
    AND invitation.receiver_id = requesting_user
    AND invitation.game_id IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'accepted', 'gameId', invitation.game_id);
  END IF;

  IF p_action = 'cancel' AND invitation.sender_id <> requesting_user THEN
    RAISE EXCEPTION 'Only the sender can cancel this invitation' USING ERRCODE = '42501';
  END IF;
  IF p_action IN ('accept', 'decline') AND invitation.receiver_id <> requesting_user THEN
    RAISE EXCEPTION 'Only the recipient can respond to this invitation' USING ERRCODE = '42501';
  END IF;

  IF invitation.status <> 'pending' THEN
    RAISE EXCEPTION 'Invitation is no longer pending';
  END IF;

  IF invitation.expires_at <= NOW() THEN
    UPDATE public.game_invitations
    SET status = 'expired', updated_at = NOW()
    WHERE id = p_invitation_id;
    RETURN jsonb_build_object('status', 'expired');
  END IF;

  IF p_action = 'cancel' THEN
    IF invitation.sender_id <> requesting_user THEN
      RAISE EXCEPTION 'Only the sender can cancel this invitation';
    END IF;
    UPDATE public.game_invitations
    SET status = 'cancelled', updated_at = NOW()
    WHERE id = p_invitation_id;
    RETURN jsonb_build_object('status', 'cancelled');
  END IF;

  IF p_action = 'decline' THEN
    IF invitation.receiver_id <> requesting_user THEN
      RAISE EXCEPTION 'Only the recipient can decline this invitation';
    END IF;
    UPDATE public.game_invitations
    SET status = 'declined', updated_at = NOW()
    WHERE id = p_invitation_id;
    RETURN jsonb_build_object('status', 'declined');
  END IF;

  IF p_action = 'accept' THEN
    IF invitation.receiver_id <> requesting_user THEN
      RAISE EXCEPTION 'Only the recipient can accept this invitation';
    END IF;

    IF invitation.selected_color = 'white' THEN
      white_id := invitation.sender_id;
      black_id := invitation.receiver_id;
    ELSIF invitation.selected_color = 'black' THEN
      white_id := invitation.receiver_id;
      black_id := invitation.sender_id;
    ELSE
      IF random() < 0.5 THEN
        white_id := invitation.sender_id;
        black_id := invitation.receiver_id;
      ELSE
        white_id := invitation.receiver_id;
        black_id := invitation.sender_id;
      END IF;
    END IF;

    SELECT rating INTO white_rating_val FROM public.profiles WHERE id = white_id;
    SELECT rating INTO black_rating_val FROM public.profiles WHERE id = black_id;

    INSERT INTO public.games (
      white_player_id, black_player_id, white_rating, black_rating,
      time_control, status, result
    )
    VALUES (
      white_id, black_id, COALESCE(white_rating_val, 1200), COALESCE(black_rating_val, 1200),
      invitation.time_control, 'in_progress', 'in_progress'
    )
    RETURNING id INTO new_game_id;

    UPDATE public.game_invitations
    SET status = 'accepted',
        game_id = new_game_id,
        updated_at = NOW()
    WHERE id = p_invitation_id;

    RETURN jsonb_build_object(
      'status', 'accepted',
      'gameId', new_game_id
    );
  END IF;

  RAISE EXCEPTION 'Invalid action';
END;
$$;

REVOKE ALL ON FUNCTION public.send_game_invitation(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.respond_game_invitation(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_game_invitation(TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_game_invitation(UUID, TEXT) TO authenticated;
