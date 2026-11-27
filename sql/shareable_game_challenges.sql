CREATE TABLE IF NOT EXISTS public.shareable_game_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  recipient_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  accepted_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  time_control TEXT NOT NULL CHECK (time_control IN ('1+0', '3+0', '3+2', '5+0', '10+0', '10+5', '15+10')),
  selected_color TEXT NOT NULL DEFAULT 'random' CHECK (selected_color IN ('white', 'black', 'random')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'cancelled')),
  game_id UUID REFERENCES public.games(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '1 hour'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (accepted_by IS NULL OR creator_id <> accepted_by)
);

ALTER TABLE public.shareable_game_challenges
  ADD COLUMN IF NOT EXISTS recipient_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'shareable_game_challenges_recipient_not_creator'
      AND conrelid = 'public.shareable_game_challenges'::regclass
  ) THEN
    ALTER TABLE public.shareable_game_challenges
      ADD CONSTRAINT shareable_game_challenges_recipient_not_creator
      CHECK (recipient_id IS NULL OR creator_id <> recipient_id);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_shareable_game_challenges_creator
  ON public.shareable_game_challenges(creator_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shareable_game_challenges_recipient_pending
  ON public.shareable_game_challenges(recipient_id, created_at DESC)
  WHERE status = 'pending';

ALTER TABLE public.shareable_game_challenges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.shareable_game_challenges FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public.create_shareable_game_challenge(TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.create_shareable_game_challenge(
  p_time_control TEXT DEFAULT '3+2',
  p_selected_color TEXT DEFAULT 'random',
  p_recipient_username TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  requesting_user UUID := auth.uid();
  target_user UUID;
  challenge_id UUID;
BEGIN
  IF requesting_user IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_time_control NOT IN ('1+0', '3+0', '3+2', '5+0', '10+0', '10+5', '15+10') THEN
    RAISE EXCEPTION 'Invalid time control';
  END IF;

  IF p_selected_color NOT IN ('white', 'black', 'random') THEN
    RAISE EXCEPTION 'Invalid color choice';
  END IF;

  IF NULLIF(BTRIM(p_recipient_username), '') IS NOT NULL THEN
    SELECT id INTO target_user
    FROM public.profiles
    WHERE LOWER(username) = LOWER(BTRIM(p_recipient_username));

    IF target_user IS NULL THEN
      RAISE EXCEPTION 'Player not found';
    END IF;

    IF target_user = requesting_user THEN
      RAISE EXCEPTION 'You cannot challenge yourself';
    END IF;
  END IF;

  INSERT INTO public.shareable_game_challenges (creator_id, recipient_id, time_control, selected_color)
  VALUES (requesting_user, target_user, p_time_control, p_selected_color)
  RETURNING id INTO challenge_id;

  RETURN jsonb_build_object('status', 'created', 'challengeId', challenge_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_shareable_game_challenge(p_challenge_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  requesting_user UUID := auth.uid();
  challenge public.shareable_game_challenges%ROWTYPE;
  creator_username TEXT;
  creator_rating INTEGER;
  recipient_username TEXT;
BEGIN
  IF requesting_user IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO challenge
  FROM public.shareable_game_challenges
  WHERE id = p_challenge_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  IF challenge.status = 'pending' AND challenge.expires_at <= NOW() THEN
    UPDATE public.shareable_game_challenges
    SET status = 'expired'
    WHERE id = challenge.id;
    challenge.status := 'expired';
  END IF;

  SELECT username, rating INTO creator_username, creator_rating
  FROM public.profiles
  WHERE id = challenge.creator_id;

  IF challenge.recipient_id IS NOT NULL THEN
    SELECT username INTO recipient_username
    FROM public.profiles
    WHERE id = challenge.recipient_id;
  END IF;

  RETURN jsonb_build_object(
    'id', challenge.id,
    'status', challenge.status,
    'timeControl', challenge.time_control,
    'selectedColor', challenge.selected_color,
    'expiresAt', challenge.expires_at,
    'creator', jsonb_build_object('username', creator_username, 'rating', COALESCE(creator_rating, 1200)),
    'recipientUsername', recipient_username,
    'isCreator', challenge.creator_id = requesting_user,
    'isRecipient', challenge.recipient_id IS NULL OR challenge.recipient_id = requesting_user,
    'isAcceptedPlayer', COALESCE(challenge.accepted_by = requesting_user, FALSE),
    'gameId', challenge.game_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_shareable_game_challenge(p_challenge_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  requesting_user UUID := auth.uid();
  challenge public.shareable_game_challenges%ROWTYPE;
  white_id UUID;
  black_id UUID;
  white_rating_val INTEGER;
  black_rating_val INTEGER;
  new_game_id UUID;
BEGIN
  IF requesting_user IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO challenge
  FROM public.shareable_game_challenges
  WHERE id = p_challenge_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  IF challenge.creator_id = requesting_user THEN
    RAISE EXCEPTION 'You cannot accept your own challenge';
  END IF;

  IF challenge.status <> 'pending' THEN
    IF challenge.status = 'accepted'
      AND (challenge.creator_id = requesting_user OR challenge.accepted_by = requesting_user) THEN
      RETURN jsonb_build_object('status', challenge.status, 'gameId', challenge.game_id);
    END IF;
    RETURN jsonb_build_object('status', challenge.status);
  END IF;

  IF challenge.recipient_id IS NOT NULL AND challenge.recipient_id <> requesting_user THEN
    RAISE EXCEPTION 'This challenge is for another player';
  END IF;

  IF challenge.expires_at <= NOW() THEN
    UPDATE public.shareable_game_challenges
    SET status = 'expired'
    WHERE id = challenge.id;
    RETURN jsonb_build_object('status', 'expired');
  END IF;

  IF challenge.selected_color = 'white' THEN
    white_id := challenge.creator_id;
    black_id := requesting_user;
  ELSIF challenge.selected_color = 'black' THEN
    white_id := requesting_user;
    black_id := challenge.creator_id;
  ELSIF random() < 0.5 THEN
    white_id := challenge.creator_id;
    black_id := requesting_user;
  ELSE
    white_id := requesting_user;
    black_id := challenge.creator_id;
  END IF;

  SELECT rating INTO white_rating_val FROM public.profiles WHERE id = white_id;
  SELECT rating INTO black_rating_val FROM public.profiles WHERE id = black_id;

  INSERT INTO public.games (
    white_player_id, black_player_id, white_rating, black_rating, time_control, status, result
  )
  VALUES (
    white_id,
    black_id,
    COALESCE(white_rating_val, 1200),
    COALESCE(black_rating_val, 1200),
    challenge.time_control,
    'in_progress',
    'in_progress'
  )
  RETURNING id INTO new_game_id;

  UPDATE public.shareable_game_challenges
  SET status = 'accepted', accepted_by = requesting_user, game_id = new_game_id
  WHERE id = challenge.id;

  RETURN jsonb_build_object('status', 'accepted', 'gameId', new_game_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_shareable_game_challenge(p_challenge_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  requesting_user UUID := auth.uid();
  challenge public.shareable_game_challenges%ROWTYPE;
BEGIN
  IF requesting_user IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO challenge
  FROM public.shareable_game_challenges
  WHERE id = p_challenge_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  IF challenge.creator_id <> requesting_user THEN
    RAISE EXCEPTION 'Only the challenge creator can cancel it';
  END IF;

  IF challenge.status <> 'pending' THEN
    RETURN jsonb_build_object('status', challenge.status);
  END IF;

  UPDATE public.shareable_game_challenges
  SET status = 'cancelled'
  WHERE id = challenge.id;

  RETURN jsonb_build_object('status', 'cancelled');
END;
$$;

REVOKE ALL ON FUNCTION public.create_shareable_game_challenge(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_shareable_game_challenge(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.accept_shareable_game_challenge(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_shareable_game_challenge(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_shareable_game_challenge(TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_shareable_game_challenge(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_shareable_game_challenge(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_shareable_game_challenge(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
