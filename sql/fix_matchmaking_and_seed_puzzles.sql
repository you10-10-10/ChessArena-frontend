-- Apply in the Supabase SQL Editor to repair an existing installation.
-- Safe to rerun: missing columns are added once and puzzle IDs are stable.

ALTER TABLE public.games
  ADD COLUMN IF NOT EXISTS white_player_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS black_player_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS white_rating INTEGER DEFAULT 1200,
  ADD COLUMN IF NOT EXISTS black_rating INTEGER DEFAULT 1200,
  ADD COLUMN IF NOT EXISTS white_rating_change INTEGER,
  ADD COLUMN IF NOT EXISTS black_rating_change INTEGER,
  ADD COLUMN IF NOT EXISTS time_control TEXT NOT NULL DEFAULT '3+2',
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pgn TEXT,
  ADD COLUMN IF NOT EXISTS moves JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS fen TEXT DEFAULT 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

WITH missing_profiles AS (
  SELECT
    u.id,
    NULLIF(BTRIM(u.raw_user_meta_data->>'username'), '') AS requested_username,
    NULLIF(BTRIM(u.raw_user_meta_data->>'full_name'), '') AS full_name
  FROM auth.users AS u
  WHERE NOT EXISTS (
    SELECT 1 FROM public.profiles AS p WHERE p.id = u.id
  )
),
username_candidates AS (
  SELECT
    id,
    requested_username,
    full_name,
    COUNT(*) OVER (PARTITION BY requested_username) AS username_count
  FROM missing_profiles
)
INSERT INTO public.profiles (id, username, full_name, rating, preferences)
SELECT
  candidate.id,
  CASE
    WHEN candidate.requested_username IS NOT NULL
      AND LENGTH(candidate.requested_username) >= 3
      AND candidate.username_count = 1
      AND NOT EXISTS (
        SELECT 1
        FROM public.profiles AS existing
        WHERE existing.username = candidate.requested_username
      )
      THEN candidate.requested_username
    ELSE 'player_' || REPLACE(candidate.id::TEXT, '-', '')
  END,
  COALESCE(candidate.full_name, 'Chess Player'),
  1200,
  '{"boardTheme": "dark", "pieceTheme": "standard", "soundEnabled": true}'::jsonb
FROM username_candidates AS candidate
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_preferences (user_id, preferences)
SELECT
  p.id,
  '{"boardTheme": "dark", "pieceTheme": "standard", "soundEnabled": true}'::jsonb
FROM public.profiles AS p
ON CONFLICT (user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.apply_online_game_action(
  p_game_id UUID,
  p_actor_id UUID,
  p_expected_fen TEXT,
  p_action TEXT,
  p_next_fen TEXT DEFAULT NULL,
  p_moves JSONB DEFAULT NULL,
  p_pgn TEXT DEFAULT NULL,
  p_result TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  selected_game public.games%ROWTYPE;
  white_rating_now INTEGER;
  black_rating_now INTEGER;
  white_games_played INTEGER;
  black_games_played INTEGER;
  white_score NUMERIC;
  expected_white_score NUMERIC;
  white_k_factor INTEGER;
  black_k_factor INTEGER;
  white_change INTEGER;
  black_change INTEGER;
BEGIN
  IF p_actor_id IS NULL OR p_expected_fen IS NULL THEN
    RAISE EXCEPTION 'Missing game action identity or state' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO selected_game
  FROM public.games
  WHERE id = p_game_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Game not found' USING ERRCODE = 'P0002';
  END IF;
  IF selected_game.white_player_id IS NULL OR selected_game.black_player_id IS NULL
    OR (p_actor_id IS DISTINCT FROM selected_game.white_player_id
      AND p_actor_id IS DISTINCT FROM selected_game.black_player_id) THEN
    RAISE EXCEPTION 'You are not a participant in this game' USING ERRCODE = '42501';
  END IF;
  IF selected_game.status <> 'in_progress' OR selected_game.result <> 'in_progress' THEN
    RAISE EXCEPTION 'Game is not in progress' USING ERRCODE = '40001';
  END IF;
  IF selected_game.fen IS DISTINCT FROM p_expected_fen THEN
    RAISE EXCEPTION 'Game changed; refresh before retrying' USING ERRCODE = '40001';
  END IF;

  IF p_action = 'move' THEN
    IF p_next_fen IS NULL OR BTRIM(p_next_fen) = ''
      OR p_moves IS NULL
      OR jsonb_typeof(p_moves) <> 'array'
      OR p_pgn IS NULL
      OR p_result IS NULL
      OR p_result NOT IN ('in_progress', 'white_wins', 'black_wins', 'draw') THEN
      RAISE EXCEPTION 'Invalid move state' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_moves) AS submitted_move(value)
      WHERE jsonb_typeof(submitted_move.value) <> 'string'
    ) OR jsonb_array_length(p_moves) <> jsonb_array_length(COALESCE(selected_game.moves, '[]'::jsonb)) + 1 THEN
      RAISE EXCEPTION 'Move history is invalid' USING ERRCODE = '22023';
    END IF;
    IF selected_game.moves IS NOT NULL AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(selected_game.moves) WITH ORDINALITY AS old_move(value, position)
      WHERE p_moves->(old_move.position - 1) IS DISTINCT FROM old_move.value
    ) THEN
      RAISE EXCEPTION 'Move history changed; refresh before retrying' USING ERRCODE = '40001';
    END IF;

    UPDATE public.games
    SET fen = p_next_fen,
        moves = p_moves,
        pgn = p_pgn,
        result = p_result,
        status = CASE WHEN p_result = 'in_progress' THEN 'in_progress' ELSE 'completed' END,
        ended_at = CASE WHEN p_result = 'in_progress' THEN NULL ELSE NOW() END,
        updated_at = NOW()
    WHERE id = p_game_id
    RETURNING * INTO selected_game;
  ELSIF p_action = 'resign' THEN
    p_result := CASE
      WHEN p_actor_id = selected_game.white_player_id THEN 'black_wins'
      ELSE 'white_wins'
    END;
    UPDATE public.games
    SET result = p_result,
        status = 'completed',
        ended_at = NOW(),
        updated_at = NOW()
    WHERE id = p_game_id
    RETURNING * INTO selected_game;
  ELSE
    RAISE EXCEPTION 'Invalid game action' USING ERRCODE = '22023';
  END IF;

  IF selected_game.status <> 'completed' THEN
    RETURN jsonb_build_object('status', selected_game.status, 'result', selected_game.result);
  END IF;

  PERFORM profile.id
  FROM public.profiles AS profile
  WHERE profile.id IN (selected_game.white_player_id, selected_game.black_player_id)
  ORDER BY profile.id
  FOR UPDATE;

  SELECT COALESCE(white.rating, 1200), COALESCE(white.games_played, 0),
         COALESCE(black.rating, 1200), COALESCE(black.games_played, 0)
  INTO white_rating_now, white_games_played, black_rating_now, black_games_played
  FROM public.profiles AS white
  JOIN public.profiles AS black ON black.id = selected_game.black_player_id
  WHERE white.id = selected_game.white_player_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'A game participant profile is missing' USING ERRCODE = '23503';
  END IF;

  white_score := CASE selected_game.result
    WHEN 'white_wins' THEN 1
    WHEN 'black_wins' THEN 0
    ELSE 0.5
  END;
  expected_white_score := 1 / (
    1 + POWER(10::NUMERIC, (black_rating_now - white_rating_now)::NUMERIC / 400)
  );
  white_k_factor := CASE
    WHEN white_games_played < 30 THEN 40
    WHEN white_rating_now >= 2400 THEN 10
    ELSE 20
  END;
  black_k_factor := CASE
    WHEN black_games_played < 30 THEN 40
    WHEN black_rating_now >= 2400 THEN 10
    ELSE 20
  END;
  white_change := ROUND(white_k_factor * (white_score - expected_white_score))::INTEGER;
  black_change := ROUND(black_k_factor * ((1 - white_score) - (1 - expected_white_score)))::INTEGER;

  UPDATE public.profiles
  SET rating = GREATEST(0, COALESCE(rating, 1200) + white_change),
      games_played = COALESCE(games_played, 0) + 1,
      wins = COALESCE(wins, 0) + CASE WHEN selected_game.result = 'white_wins' THEN 1 ELSE 0 END,
      losses = COALESCE(losses, 0) + CASE WHEN selected_game.result = 'black_wins' THEN 1 ELSE 0 END,
      draws = COALESCE(draws, 0) + CASE WHEN selected_game.result = 'draw' THEN 1 ELSE 0 END,
      updated_at = NOW()
  WHERE id = selected_game.white_player_id;

  UPDATE public.profiles
  SET rating = GREATEST(0, COALESCE(rating, 1200) + black_change),
      games_played = COALESCE(games_played, 0) + 1,
      wins = COALESCE(wins, 0) + CASE WHEN selected_game.result = 'black_wins' THEN 1 ELSE 0 END,
      losses = COALESCE(losses, 0) + CASE WHEN selected_game.result = 'white_wins' THEN 1 ELSE 0 END,
      draws = COALESCE(draws, 0) + CASE WHEN selected_game.result = 'draw' THEN 1 ELSE 0 END,
      updated_at = NOW()
  WHERE id = selected_game.black_player_id;

  UPDATE public.games
  SET white_rating_change = white_change,
      black_rating_change = black_change
  WHERE id = p_game_id;

  RETURN jsonb_build_object(
    'status', selected_game.status,
    'result', selected_game.result,
    'whiteRatingChange', white_change,
    'blackRatingChange', black_change
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_online_game_action(UUID, UUID, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_online_game_action(UUID, UUID, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT)
  TO service_role;

CREATE TABLE IF NOT EXISTS public.clubs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  owner_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (char_length(name) BETWEEN 3 AND 40),
  CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

CREATE TABLE IF NOT EXISTS public.club_members (
  club_id UUID NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'moderator', 'member')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (club_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.direct_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (char_length(BTRIM(body)) BETWEEN 1 AND 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at TIMESTAMPTZ,
  CHECK (sender_id <> recipient_id)
);

ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS club_id UUID REFERENCES public.clubs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_rated BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_club_members_user ON public.club_members(user_id, club_id);
CREATE INDEX IF NOT EXISTS idx_tournaments_club_start ON public.tournaments(club_id, start_date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_clubs_slug_lower ON public.clubs(LOWER(slug));
CREATE INDEX IF NOT EXISTS idx_direct_messages_conversation
  ON public.direct_messages(sender_id, recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_direct_messages_inbox
  ON public.direct_messages(recipient_id, created_at DESC)
  WHERE read_at IS NULL;

ALTER TABLE public.clubs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.direct_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public clubs read" ON public.clubs;
DROP POLICY IF EXISTS "Club memberships read" ON public.club_members;
DROP POLICY IF EXISTS "Friends read direct messages" ON public.direct_messages;
CREATE POLICY "Public clubs read" ON public.clubs FOR SELECT USING (visibility = 'public');
CREATE POLICY "Club memberships read" ON public.club_members FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.clubs
    WHERE clubs.id = club_members.club_id AND clubs.visibility = 'public'
  ));
REVOKE ALL ON public.clubs, public.club_members FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.clubs, public.club_members TO anon, authenticated;
CREATE POLICY "Friends read direct messages" ON public.direct_messages FOR SELECT
  USING (
    auth.uid() IN (sender_id, recipient_id)
    AND EXISTS (
      SELECT 1
      FROM public.friendships AS friendship
      WHERE friendship.status = 'accepted'
        AND (
          (friendship.user_id = direct_messages.sender_id AND friendship.friend_id = direct_messages.recipient_id)
          OR
          (friendship.user_id = direct_messages.recipient_id AND friendship.friend_id = direct_messages.sender_id)
        )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.friendships AS blocked
      WHERE blocked.status = 'blocked'
        AND (
          (blocked.user_id = direct_messages.sender_id AND blocked.friend_id = direct_messages.recipient_id)
          OR
          (blocked.user_id = direct_messages.recipient_id AND blocked.friend_id = direct_messages.sender_id)
        )
    )
  );
REVOKE ALL ON public.direct_messages FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, sender_id, recipient_id, body, created_at, read_at)
  ON public.direct_messages TO authenticated;

CREATE OR REPLACE FUNCTION public.send_direct_message(p_recipient_id UUID, p_body TEXT)
RETURNS public.direct_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  requesting_user UUID := auth.uid();
  created_message public.direct_messages%ROWTYPE;
BEGIN
  IF requesting_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_recipient_id IS NULL OR p_recipient_id = requesting_user THEN
    RAISE EXCEPTION 'Choose a friend to message';
  END IF;
  IF p_body IS NULL OR char_length(BTRIM(p_body)) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'Message must contain between 1 and 2000 characters';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.friendships AS friendship
    WHERE friendship.status = 'accepted'
      AND (
        (friendship.user_id = requesting_user AND friendship.friend_id = p_recipient_id)
        OR
        (friendship.user_id = p_recipient_id AND friendship.friend_id = requesting_user)
      )
  ) OR EXISTS (
    SELECT 1 FROM public.friendships AS blocked
    WHERE blocked.status = 'blocked'
      AND (
        (blocked.user_id = requesting_user AND blocked.friend_id = p_recipient_id)
        OR
        (blocked.user_id = p_recipient_id AND blocked.friend_id = requesting_user)
      )
  ) THEN
    RAISE EXCEPTION 'Messages are available between accepted friends only';
  END IF;
  INSERT INTO public.direct_messages (sender_id, recipient_id, body)
  VALUES (requesting_user, p_recipient_id, BTRIM(p_body))
  RETURNING * INTO created_message;
  RETURN created_message;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_direct_messages_read(p_sender_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  requesting_user UUID := auth.uid();
  updated_count INTEGER;
BEGIN
  IF requesting_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.friendships AS friendship
    WHERE friendship.status = 'accepted'
      AND (
        (friendship.user_id = requesting_user AND friendship.friend_id = p_sender_id)
        OR
        (friendship.user_id = p_sender_id AND friendship.friend_id = requesting_user)
      )
  ) OR EXISTS (
    SELECT 1 FROM public.friendships AS blocked
    WHERE blocked.status = 'blocked'
      AND (
        (blocked.user_id = requesting_user AND blocked.friend_id = p_sender_id)
        OR
        (blocked.user_id = p_sender_id AND blocked.friend_id = requesting_user)
      )
  ) THEN
    RAISE EXCEPTION 'Messages are available between accepted friends only';
  END IF;
  UPDATE public.direct_messages
  SET read_at = NOW()
  WHERE sender_id = p_sender_id AND recipient_id = requesting_user AND read_at IS NULL;
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;

REVOKE ALL ON FUNCTION public.send_direct_message(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_direct_messages_read(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_direct_message(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_direct_messages_read(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_club(p_name TEXT, p_slug TEXT, p_description TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  requesting_user UUID := auth.uid();
  created_club_id UUID;
BEGIN
  IF requesting_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_name IS NULL OR char_length(BTRIM(p_name)) NOT BETWEEN 3 AND 40 THEN
    RAISE EXCEPTION 'Club name must be between 3 and 40 characters';
  END IF;
  IF p_slug IS NULL OR p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' OR char_length(p_slug) > 48 THEN
    RAISE EXCEPTION 'Club address is invalid';
  END IF;
  IF p_description IS NOT NULL AND char_length(p_description) > 500 THEN
    RAISE EXCEPTION 'Club description is too long';
  END IF;
  INSERT INTO public.clubs (name, slug, description, owner_id)
  VALUES (BTRIM(p_name), p_slug, NULLIF(BTRIM(p_description), ''), requesting_user)
  RETURNING id INTO created_club_id;
  INSERT INTO public.club_members (club_id, user_id, role)
  VALUES (created_club_id, requesting_user, 'owner');
  RETURN jsonb_build_object('id', created_club_id, 'slug', p_slug);
END;
$$;

CREATE OR REPLACE FUNCTION public.join_club(p_club_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  requesting_user UUID := auth.uid();
  selected_club public.clubs%ROWTYPE;
  inserted_count INTEGER;
BEGIN
  IF requesting_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO selected_club FROM public.clubs WHERE id = p_club_id FOR UPDATE;
  IF NOT FOUND OR selected_club.visibility <> 'public' THEN RAISE EXCEPTION 'Public club not found'; END IF;
  INSERT INTO public.club_members (club_id, user_id, role)
  VALUES (p_club_id, requesting_user, 'member')
  ON CONFLICT (club_id, user_id) DO NOTHING;
  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN jsonb_build_object('status', CASE WHEN inserted_count = 0 THEN 'already_member' ELSE 'joined' END);
END;
$$;

CREATE OR REPLACE FUNCTION public.leave_club(p_club_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  requesting_user UUID := auth.uid();
  deleted_count INTEGER;
BEGIN
  IF requesting_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  DELETE FROM public.club_members
  WHERE club_id = p_club_id AND user_id = requesting_user AND role <> 'owner';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  IF deleted_count = 0 THEN
    IF EXISTS (SELECT 1 FROM public.club_members WHERE club_id = p_club_id AND user_id = requesting_user AND role = 'owner') THEN
      RAISE EXCEPTION 'The club owner cannot leave without transferring ownership';
    END IF;
    RETURN jsonb_build_object('status', 'not_a_member');
  END IF;
  RETURN jsonb_build_object('status', 'left');
END;
$$;

CREATE OR REPLACE FUNCTION public.create_tournament(
  p_name TEXT,
  p_description TEXT,
  p_format TEXT,
  p_time_control TEXT,
  p_start_date TIMESTAMPTZ,
  p_max_participants INTEGER,
  p_club_id UUID DEFAULT NULL,
  p_is_rated BOOLEAN DEFAULT FALSE
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  requesting_user UUID := auth.uid();
  created_tournament_id UUID;
BEGIN
  IF requesting_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_name IS NULL OR char_length(BTRIM(p_name)) NOT BETWEEN 3 AND 80 THEN
    RAISE EXCEPTION 'Tournament name must be between 3 and 80 characters';
  END IF;
  IF p_description IS NOT NULL AND char_length(p_description) > 1000 THEN
    RAISE EXCEPTION 'Tournament description is too long';
  END IF;
  IF p_format NOT IN ('arena', 'swiss', 'knockout', 'round_robin') THEN
    RAISE EXCEPTION 'Unsupported tournament format';
  END IF;
  IF p_time_control NOT IN ('1+0', '3+0', '3+2', '5+0', '10+0', '10+5', '15+10') THEN
    RAISE EXCEPTION 'Unsupported time control';
  END IF;
  IF p_start_date IS NULL OR p_start_date < NOW() + INTERVAL '5 minutes' THEN
    RAISE EXCEPTION 'Tournament must start at least five minutes from now';
  END IF;
  IF p_max_participants IS NULL OR p_max_participants NOT BETWEEN 2 AND 512 THEN
    RAISE EXCEPTION 'Participant limit must be between 2 and 512';
  END IF;
  IF p_club_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.club_members
    WHERE club_id = p_club_id AND user_id = requesting_user AND role IN ('owner', 'admin', 'moderator')
  ) THEN
    RAISE EXCEPTION 'Only club organizers can create a club tournament';
  END IF;
  INSERT INTO public.tournaments (
    name, description, organizer_id, format, status, time_control, start_date,
    max_participants, club_id, is_rated
  )
  VALUES (
    BTRIM(p_name), NULLIF(BTRIM(p_description), ''), requesting_user, p_format,
    'upcoming', p_time_control, p_start_date, p_max_participants, p_club_id,
    COALESCE(p_is_rated, FALSE)
  )
  RETURNING id INTO created_tournament_id;
  RETURN created_tournament_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_club(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.join_club(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.leave_club(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_tournament(TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, INTEGER, UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_club(TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.join_club(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.leave_club(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_tournament(TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, INTEGER, UUID, BOOLEAN) TO authenticated;

CREATE TABLE IF NOT EXISTS public.puzzles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fen TEXT NOT NULL,
  solution_moves JSONB NOT NULL,
  rating INTEGER DEFAULT 1200,
  category TEXT,
  difficulty TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.puzzle_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  puzzle_id UUID REFERENCES public.puzzles(id) ON DELETE CASCADE,
  solved BOOLEAN DEFAULT FALSE,
  attempts INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, puzzle_id)
);

ALTER TABLE public.puzzles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.puzzle_progress ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Puzzles public" ON public.puzzles;
DROP POLICY IF EXISTS "Puzzle progress public" ON public.puzzle_progress;
DROP POLICY IF EXISTS "Users read own puzzle progress" ON public.puzzle_progress;
DROP POLICY IF EXISTS "Users insert own puzzle progress" ON public.puzzle_progress;
DROP POLICY IF EXISTS "Users update own puzzle progress" ON public.puzzle_progress;
CREATE POLICY "Puzzles public" ON public.puzzles FOR SELECT USING (true);
CREATE POLICY "Users read own puzzle progress" ON public.puzzle_progress FOR SELECT
  USING (auth.uid() = user_id);

REVOKE ALL ON public.puzzles, public.puzzle_progress FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, fen, rating, category, difficulty, created_at)
  ON public.puzzles TO anon, authenticated;
GRANT SELECT ON public.puzzle_progress TO authenticated;
GRANT ALL ON public.puzzles, public.puzzle_progress TO service_role;

INSERT INTO public.puzzles (id, fen, solution_moves, rating, category, difficulty)
VALUES
  (
    '00000000-0000-4000-8000-000000000001',
    '7k/8/5KQ1/8/8/8/8/8 w - - 0 1',
    '["Qg7#"]'::jsonb,
    800,
    'Checkmate',
    'Beginner'
  ),
  (
    '00000000-0000-4000-8000-000000000002',
    '6k1/5ppp/8/8/8/5Q2/5PPP/6K1 w - - 0 1',
    '["Qa8#"]'::jsonb,
    900,
    'Checkmate',
    'Beginner'
  )
ON CONFLICT (id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
