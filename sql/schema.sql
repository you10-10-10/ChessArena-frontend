
-- ChessArena Comprehensive SQL Schema
-- Includes profiles, games, moves, tournaments, puzzles, and leaderboard

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Profiles
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT UNIQUE NOT NULL,
  full_name TEXT,
  avatar_url TEXT,
  rating INTEGER DEFAULT 1200,
  games_played INTEGER DEFAULT 0,
  wins INTEGER DEFAULT 0,
  losses INTEGER DEFAULT 0,
  draws INTEGER DEFAULT 0,
  join_date TIMESTAMPTZ DEFAULT NOW(),
  preferences JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Upgrade profile tables created by earlier schema versions.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS full_name TEXT,
  ADD COLUMN IF NOT EXISTS avatar_url TEXT,
  ADD COLUMN IF NOT EXISTS rating INTEGER DEFAULT 1200,
  ADD COLUMN IF NOT EXISTS games_played INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wins INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS losses INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS draws INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS join_date TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS preferences JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  preferences JSONB NOT NULL DEFAULT '{"boardTheme": "dark", "pieceTheme": "standard", "soundEnabled": true}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Games
CREATE TABLE IF NOT EXISTS games (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  white_player_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  black_player_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  result TEXT DEFAULT 'in_progress' CHECK (result IN ('in_progress', 'white_wins', 'black_wins', 'draw', 'abandoned')),
  white_rating INTEGER DEFAULT 1200,
  black_rating INTEGER DEFAULT 1200,
  white_rating_change INTEGER,
  black_rating_change INTEGER,
  time_control TEXT NOT NULL DEFAULT '3+2',
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  pgn TEXT,
  moves JSONB DEFAULT '[]'::jsonb,
  fen TEXT DEFAULT 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  status TEXT DEFAULT 'in_progress' CHECK (status IN ('waiting', 'in_progress', 'completed', 'abandoned')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Upgrade games tables created by earlier schema versions.
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

-- 3. Game Moves
CREATE TABLE IF NOT EXISTS game_moves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID REFERENCES games(id) ON DELETE CASCADE,
  move_number INTEGER NOT NULL,
  player_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  move_san TEXT NOT NULL,
  fen TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

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

-- 4. Tournaments
CREATE TABLE IF NOT EXISTS tournaments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  organizer_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  format TEXT NOT NULL CHECK (format IN ('arena', 'swiss', 'knockout', 'round_robin')),
  status TEXT DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'live', 'completed')),
  time_control TEXT NOT NULL DEFAULT '3+2',
  start_date TIMESTAMPTZ NOT NULL,
  max_participants INTEGER DEFAULT 64,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Tournament Players
CREATE TABLE IF NOT EXISTS tournament_players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID REFERENCES tournaments(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  score NUMERIC(4,1) DEFAULT 0.0,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tournament_id, user_id)
);

CREATE TABLE IF NOT EXISTS tournament_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  inviter_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  invitee_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tournament_id, invitee_id),
  CHECK (inviter_id <> invitee_id)
);

-- 6. Puzzles
CREATE TABLE IF NOT EXISTS puzzles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fen TEXT NOT NULL,
  solution_moves JSONB NOT NULL,
  rating INTEGER DEFAULT 1200,
  category TEXT,
  difficulty TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

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

-- 7. Puzzle Progress
CREATE TABLE IF NOT EXISTS puzzle_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  puzzle_id UUID REFERENCES puzzles(id) ON DELETE CASCADE,
  solved BOOLEAN DEFAULT FALSE,
  attempts INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, puzzle_id)
);

-- 8. Leaderboard View / Table
CREATE TABLE IF NOT EXISTS leaderboard (
  user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  rating INTEGER DEFAULT 1200,
  games_played INTEGER DEFAULT 0,
  wins INTEGER DEFAULT 0,
  losses INTEGER DEFAULT 0,
  draws INTEGER DEFAULT 0,
  win_rate NUMERIC(5,2) DEFAULT 0.00,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. Friendships
CREATE TABLE IF NOT EXISTS friendships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  friend_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'blocked')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, friend_id)
);

CREATE TABLE IF NOT EXISTS direct_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (char_length(BTRIM(body)) BETWEEN 1 AND 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at TIMESTAMPTZ,
  CHECK (sender_id <> recipient_id)
);

-- A single active matchmaking request per account.
CREATE TABLE IF NOT EXISTS matchmaking_queue (
  user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  time_control TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'matched')),
  game_id UUID REFERENCES games(id) ON DELETE SET NULL,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Public player clubs.
CREATE TABLE IF NOT EXISTS clubs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  owner_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (char_length(name) BETWEEN 3 AND 40),
  CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

CREATE TABLE IF NOT EXISTS club_members (
  club_id UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'moderator', 'member')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (club_id, user_id)
);

ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS club_id UUID REFERENCES public.clubs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_rated BOOLEAN NOT NULL DEFAULT FALSE;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_profiles_username ON profiles(username);
CREATE INDEX IF NOT EXISTS idx_profiles_rating ON profiles(rating DESC);
CREATE INDEX IF NOT EXISTS idx_games_white ON games(white_player_id);
CREATE INDEX IF NOT EXISTS idx_games_black ON games(black_player_id);
CREATE INDEX IF NOT EXISTS idx_games_status ON games(status);
CREATE INDEX IF NOT EXISTS idx_tournaments_status ON tournaments(status);
CREATE INDEX IF NOT EXISTS idx_tournament_invitations_invitee
  ON tournament_invitations(invitee_id, created_at DESC)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_friendships_user ON friendships(user_id);
CREATE INDEX IF NOT EXISTS idx_direct_messages_conversation
  ON direct_messages(sender_id, recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_direct_messages_inbox
  ON direct_messages(recipient_id, created_at DESC)
  WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_matchmaking_waiting ON matchmaking_queue(time_control, joined_at)
  WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS idx_club_members_user ON club_members(user_id, club_id);
CREATE INDEX IF NOT EXISTS idx_tournaments_club_start ON tournaments(club_id, start_date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_clubs_slug_lower ON clubs(LOWER(slug));

-- Refuse to apply the case-insensitive username index if legacy names collide.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.profiles
    GROUP BY LOWER(username)
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot enforce case-insensitive username uniqueness: resolve existing case-insensitive username collisions, then rerun the schema migration.';
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_username_lower
  ON public.profiles (LOWER(username));

-- Enable RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE games ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_moves ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournaments ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE puzzles ENABLE ROW LEVEL SECURITY;
ALTER TABLE puzzle_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE leaderboard ENABLE ROW LEVEL SECURITY;
ALTER TABLE friendships ENABLE ROW LEVEL SECURITY;
ALTER TABLE direct_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE matchmaking_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE clubs ENABLE ROW LEVEL SECURITY;
ALTER TABLE club_members ENABLE ROW LEVEL SECURITY;

-- Remove the permissive policies from earlier schema versions before replacing them.
DROP POLICY IF EXISTS "Public profiles select" ON profiles;
DROP POLICY IF EXISTS "Users update own profile" ON profiles;
DROP POLICY IF EXISTS "Users read own preferences" ON user_preferences;
DROP POLICY IF EXISTS "Users insert own preferences" ON user_preferences;
DROP POLICY IF EXISTS "Users update own preferences" ON user_preferences;
DROP POLICY IF EXISTS "Public games select" ON games;
DROP POLICY IF EXISTS "Users insert games" ON games;
DROP POLICY IF EXISTS "Users update games" ON games;
DROP POLICY IF EXISTS "Public moves select" ON game_moves;
DROP POLICY IF EXISTS "Users insert moves" ON game_moves;
DROP POLICY IF EXISTS "Tournaments public" ON tournaments;
DROP POLICY IF EXISTS "Tournament players public" ON tournament_players;
DROP POLICY IF EXISTS "Puzzles public" ON puzzles;
DROP POLICY IF EXISTS "Puzzle progress public" ON puzzle_progress;
DROP POLICY IF EXISTS "Leaderboard public" ON leaderboard;
DROP POLICY IF EXISTS "Friendships public" ON friendships;
DROP POLICY IF EXISTS "Game participants read games" ON games;
DROP POLICY IF EXISTS "Game participants read moves" ON game_moves;
DROP POLICY IF EXISTS "Tournaments public read" ON tournaments;
DROP POLICY IF EXISTS "Tournament players public read" ON tournament_players;
DROP POLICY IF EXISTS "Tournament invitations involved users read" ON tournament_invitations;
DROP POLICY IF EXISTS "Users join tournaments" ON tournament_players;
DROP POLICY IF EXISTS "Users read own puzzle progress" ON puzzle_progress;
DROP POLICY IF EXISTS "Users insert own puzzle progress" ON puzzle_progress;
DROP POLICY IF EXISTS "Users update own puzzle progress" ON puzzle_progress;
DROP POLICY IF EXISTS "Users read own friendships" ON friendships;
DROP POLICY IF EXISTS "Users create own friendships" ON friendships;
DROP POLICY IF EXISTS "Participants update friendships" ON friendships;
DROP POLICY IF EXISTS "Friends read direct messages" ON direct_messages;
DROP POLICY IF EXISTS "Public clubs read" ON clubs;
DROP POLICY IF EXISTS "Club memberships read" ON club_members;

-- Public reads expose only public profile/game metadata; writes remain owner-scoped.
CREATE POLICY "Public profiles select" ON profiles FOR SELECT USING (true);
CREATE POLICY "Users update own profile" ON profiles FOR UPDATE
  USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
REVOKE UPDATE ON public.profiles FROM anon, authenticated;
REVOKE SELECT ON public.profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, username, full_name, avatar_url, rating, games_played, wins, losses, draws, join_date, created_at, updated_at)
  ON public.profiles TO anon, authenticated;
GRANT UPDATE (full_name, avatar_url) ON public.profiles TO authenticated;

CREATE POLICY "Users read own preferences" ON user_preferences FOR SELECT
  USING (auth.uid() = user_id);
CREATE POLICY "Users insert own preferences" ON user_preferences FOR INSERT
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own preferences" ON user_preferences FOR UPDATE
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
REVOKE ALL ON public.user_preferences FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.user_preferences TO authenticated;
INSERT INTO public.user_preferences (user_id, preferences)
SELECT id, COALESCE(preferences, '{}'::jsonb)
FROM public.profiles
ON CONFLICT (user_id) DO NOTHING;

CREATE POLICY "Game participants read games" ON games FOR SELECT
  USING (auth.uid() = white_player_id OR auth.uid() = black_player_id);
REVOKE SELECT ON public.games FROM PUBLIC, anon;
GRANT SELECT ON public.games TO authenticated;
CREATE POLICY "Game participants read moves" ON game_moves FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM games
    WHERE games.id = game_moves.game_id
      AND (games.white_player_id = auth.uid() OR games.black_player_id = auth.uid())
  ));

CREATE POLICY "Tournaments public read" ON tournaments FOR SELECT USING (true);
CREATE POLICY "Tournament players public read" ON tournament_players FOR SELECT USING (true);
REVOKE INSERT, UPDATE, DELETE ON public.tournament_players FROM anon, authenticated;
CREATE POLICY "Tournament invitations involved users read" ON tournament_invitations FOR SELECT
  USING (auth.uid() = inviter_id OR auth.uid() = invitee_id);
REVOKE ALL ON public.tournament_invitations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.tournament_invitations TO authenticated;
CREATE POLICY "Puzzles public" ON puzzles FOR SELECT USING (true);
REVOKE SELECT ON public.puzzles FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, fen, rating, category, difficulty, created_at) ON public.puzzles TO anon, authenticated;
CREATE POLICY "Users read own puzzle progress" ON puzzle_progress FOR SELECT
  USING (auth.uid() = user_id);
REVOKE INSERT, UPDATE, DELETE ON public.puzzle_progress FROM anon, authenticated;
CREATE POLICY "Leaderboard public" ON leaderboard FOR SELECT USING (true);
CREATE POLICY "Users read own friendships" ON friendships FOR SELECT
  USING (auth.uid() = user_id OR auth.uid() = friend_id);
CREATE POLICY "Users create own friendships" ON friendships FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND user_id <> friend_id
    AND status = 'pending'
  );
CREATE POLICY "Participants update friendships" ON friendships FOR UPDATE
  USING (auth.uid() = friend_id AND status = 'pending')
  WITH CHECK (auth.uid() = friend_id AND status IN ('accepted', 'blocked'));
REVOKE UPDATE ON public.friendships FROM anon, authenticated;
GRANT UPDATE (status) ON public.friendships TO authenticated;

CREATE POLICY "Friends read direct messages" ON direct_messages FOR SELECT
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
  IF requesting_user IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF p_recipient_id IS NULL OR p_recipient_id = requesting_user THEN
    RAISE EXCEPTION 'Choose a friend to message';
  END IF;
  IF p_body IS NULL OR char_length(BTRIM(p_body)) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'Message must contain between 1 and 2000 characters';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.friendships AS friendship
    WHERE friendship.status = 'accepted'
      AND (
        (friendship.user_id = requesting_user AND friendship.friend_id = p_recipient_id)
        OR
        (friendship.user_id = p_recipient_id AND friendship.friend_id = requesting_user)
      )
  ) OR EXISTS (
    SELECT 1
    FROM public.friendships AS blocked
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
  IF requesting_user IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.friendships AS friendship
    WHERE friendship.status = 'accepted'
      AND (
        (friendship.user_id = requesting_user AND friendship.friend_id = p_sender_id)
        OR
        (friendship.user_id = p_sender_id AND friendship.friend_id = requesting_user)
      )
  ) OR EXISTS (
    SELECT 1
    FROM public.friendships AS blocked
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
  WHERE sender_id = p_sender_id
    AND recipient_id = requesting_user
    AND read_at IS NULL;
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;

REVOKE ALL ON FUNCTION public.send_direct_message(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_direct_messages_read(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_direct_message(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_direct_messages_read(UUID) TO authenticated;

CREATE POLICY "Public clubs read" ON public.clubs FOR SELECT USING (visibility = 'public');
CREATE POLICY "Club memberships read" ON public.club_members FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.clubs
    WHERE clubs.id = club_members.club_id AND clubs.visibility = 'public'
  ));
REVOKE ALL ON public.clubs, public.club_members FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.clubs, public.club_members TO anon, authenticated;

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
  IF requesting_user IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
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
  IF requesting_user IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  SELECT * INTO selected_club
  FROM public.clubs
  WHERE id = p_club_id
  FOR UPDATE;
  IF NOT FOUND OR selected_club.visibility <> 'public' THEN
    RAISE EXCEPTION 'Public club not found';
  END IF;

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
  IF requesting_user IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
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
  IF requesting_user IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
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

CREATE OR REPLACE FUNCTION public.join_tournament(p_tournament_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  requesting_user UUID := auth.uid();
  selected_tournament public.tournaments%ROWTYPE;
  participant_count INTEGER;
  inserted_count INTEGER;
BEGIN
  IF requesting_user IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO selected_tournament
  FROM public.tournaments
  WHERE id = p_tournament_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tournament not found';
  END IF;
  IF selected_tournament.status = 'completed' THEN
    RAISE EXCEPTION 'Tournament registration is closed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.tournament_players
    WHERE tournament_id = p_tournament_id
      AND user_id = requesting_user
  ) THEN
    RETURN jsonb_build_object('status', 'already_registered');
  END IF;

  SELECT COUNT(*) INTO participant_count
  FROM public.tournament_players
  WHERE tournament_id = p_tournament_id;

  IF participant_count >= COALESCE(selected_tournament.max_participants, 64) THEN
    RAISE EXCEPTION 'Tournament is full';
  END IF;

  INSERT INTO public.tournament_players (tournament_id, user_id)
  VALUES (p_tournament_id, requesting_user)
  ON CONFLICT (tournament_id, user_id) DO NOTHING;
  GET DIAGNOSTICS inserted_count = ROW_COUNT;

  IF inserted_count = 0 THEN
    RETURN jsonb_build_object('status', 'already_registered');
  END IF;

  RETURN jsonb_build_object('status', 'registered');
END;
$$;

CREATE OR REPLACE FUNCTION public.invite_tournament_player(p_tournament_id UUID, p_username TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  requesting_user UUID := auth.uid();
  target_user UUID;
  selected_tournament public.tournaments%ROWTYPE;
  inserted_count INTEGER;
BEGIN
  IF requesting_user IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF p_username IS NULL OR p_username !~ '^[A-Za-z0-9_]{3,20}$' THEN
    RAISE EXCEPTION 'Enter a valid username';
  END IF;

  SELECT id INTO target_user
  FROM public.profiles
  WHERE lower(username) = lower(p_username);
  IF target_user IS NULL THEN
    RAISE EXCEPTION 'Player not found';
  END IF;
  IF target_user = requesting_user THEN
    RAISE EXCEPTION 'You cannot invite yourself';
  END IF;

  SELECT * INTO selected_tournament
  FROM public.tournaments
  WHERE id = p_tournament_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tournament not found';
  END IF;
  IF selected_tournament.status = 'completed' THEN
    RAISE EXCEPTION 'Tournament registration is closed';
  END IF;
  IF requesting_user <> selected_tournament.organizer_id AND NOT EXISTS (
    SELECT 1 FROM public.tournament_players
    WHERE tournament_id = p_tournament_id AND user_id = requesting_user
  ) THEN
    RAISE EXCEPTION 'Register for the tournament before inviting players';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.tournament_players
    WHERE tournament_id = p_tournament_id AND user_id = target_user
  ) THEN
    RETURN jsonb_build_object('status', 'already_registered');
  END IF;

  INSERT INTO public.tournament_invitations (tournament_id, inviter_id, invitee_id)
  VALUES (p_tournament_id, requesting_user, target_user)
  ON CONFLICT (tournament_id, invitee_id) DO UPDATE
    SET inviter_id = EXCLUDED.inviter_id,
        status = 'pending',
        created_at = NOW(),
        updated_at = NOW()
    WHERE public.tournament_invitations.status = 'declined';
  GET DIAGNOSTICS inserted_count = ROW_COUNT;

  IF inserted_count = 0 THEN
    RETURN jsonb_build_object('status', 'already_invited');
  END IF;
  RETURN jsonb_build_object('status', 'invited');
END;
$$;

CREATE OR REPLACE FUNCTION public.respond_tournament_invitation(
  p_invitation_id UUID,
  p_accept BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  requesting_user UUID := auth.uid();
  selected_invitation public.tournament_invitations%ROWTYPE;
  selected_tournament public.tournaments%ROWTYPE;
  participant_count INTEGER;
BEGIN
  IF requesting_user IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF p_accept IS NULL THEN
    RAISE EXCEPTION 'Choose whether to accept the invitation';
  END IF;

  SELECT * INTO selected_invitation
  FROM public.tournament_invitations
  WHERE id = p_invitation_id AND invitee_id = requesting_user;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found';
  END IF;

  SELECT * INTO selected_tournament
  FROM public.tournaments
  WHERE id = selected_invitation.tournament_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tournament not found';
  END IF;

  SELECT * INTO selected_invitation
  FROM public.tournament_invitations
  WHERE id = p_invitation_id AND invitee_id = requesting_user
  FOR UPDATE;
  IF selected_invitation.status <> 'pending' THEN
    RETURN jsonb_build_object('status', selected_invitation.status);
  END IF;

  IF NOT p_accept THEN
    UPDATE public.tournament_invitations
    SET status = 'declined', updated_at = NOW()
    WHERE id = p_invitation_id;
    RETURN jsonb_build_object('status', 'declined');
  END IF;
  IF selected_tournament.status = 'completed' THEN
    RAISE EXCEPTION 'Tournament registration is closed';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.tournament_players
    WHERE tournament_id = selected_tournament.id AND user_id = requesting_user
  ) THEN
    UPDATE public.tournament_invitations
    SET status = 'accepted', updated_at = NOW()
    WHERE id = p_invitation_id;
    RETURN jsonb_build_object('status', 'already_registered');
  END IF;

  SELECT COUNT(*) INTO participant_count
  FROM public.tournament_players
  WHERE tournament_id = selected_tournament.id;
  IF participant_count >= COALESCE(selected_tournament.max_participants, 64) THEN
    RAISE EXCEPTION 'Tournament is full';
  END IF;

  INSERT INTO public.tournament_players (tournament_id, user_id)
  VALUES (selected_tournament.id, requesting_user)
  ON CONFLICT (tournament_id, user_id) DO NOTHING;
  UPDATE public.tournament_invitations
  SET status = 'accepted', updated_at = NOW()
  WHERE id = p_invitation_id;
  RETURN jsonb_build_object('status', 'accepted');
END;
$$;

REVOKE ALL ON FUNCTION public.invite_tournament_player(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.respond_tournament_invitation(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invite_tournament_player(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_tournament_invitation(UUID, BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION public.join_matchmaking(p_time_control TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  requesting_user UUID := auth.uid();
  opponent_id UUID;
  created_game_id UUID;
BEGIN
  IF requesting_user IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_time_control NOT IN ('1+0', '3+0', '3+2', '5+0', '10+0', '10+5', '15+10') THEN
    RAISE EXCEPTION 'Unsupported time control';
  END IF;

  DELETE FROM matchmaking_queue WHERE user_id = requesting_user;

  SELECT user_id INTO opponent_id
  FROM matchmaking_queue
  WHERE status = 'queued'
    AND time_control = p_time_control
    AND user_id <> requesting_user
  ORDER BY joined_at
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF opponent_id IS NULL THEN
    INSERT INTO matchmaking_queue (user_id, time_control, status)
    VALUES (requesting_user, p_time_control, 'queued');
    RETURN jsonb_build_object('status', 'queued');
  END IF;

  INSERT INTO games (
    white_player_id, black_player_id, white_rating, black_rating,
    time_control, status, result
  )
  SELECT opponent_id, requesting_user, white.rating, black.rating,
    p_time_control, 'in_progress', 'in_progress'
  FROM profiles AS white
  JOIN profiles AS black ON black.id = requesting_user
  WHERE white.id = opponent_id
  RETURNING id INTO created_game_id;

  IF created_game_id IS NULL THEN
    RAISE EXCEPTION 'Unable to create matched game';
  END IF;

  UPDATE matchmaking_queue
  SET status = 'matched', game_id = created_game_id
  WHERE user_id = opponent_id;

  INSERT INTO matchmaking_queue (user_id, time_control, status, game_id)
  VALUES (requesting_user, p_time_control, 'matched', created_game_id);

  RETURN jsonb_build_object('status', 'matched', 'gameId', created_game_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.leave_matchmaking()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  DELETE FROM matchmaking_queue
  WHERE user_id = auth.uid() AND status = 'queued';
  RETURN jsonb_build_object('status', 'idle');
END;
$$;

CREATE OR REPLACE FUNCTION public.matchmaking_status()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  queue_entry matchmaking_queue%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO queue_entry
  FROM matchmaking_queue
  WHERE user_id = auth.uid();

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'idle');
  END IF;

  RETURN jsonb_build_object(
    'status', queue_entry.status,
    'gameId', queue_entry.game_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.join_matchmaking(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.leave_matchmaking() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.matchmaking_status() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.join_tournament(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.join_matchmaking(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.leave_matchmaking() TO authenticated;
GRANT EXECUTE ON FUNCTION public.matchmaking_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.join_tournament(UUID) TO authenticated;

-- Auto-create profile trigger on auth.users insert
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  requested_username TEXT := LOWER(BTRIM(NEW.raw_user_meta_data->>'username'));
  username_base TEXT;
  username_candidate TEXT;
  collision_suffix TEXT;
  attempt INTEGER := 0;
BEGIN
  IF requested_username IS NOT NULL AND requested_username <> '' THEN
    IF requested_username !~ '^[a-z0-9_]{3,20}$' THEN
      RAISE EXCEPTION 'Username must contain 3-20 letters, numbers, or underscores'
        USING ERRCODE = '23514';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM UNNEST(ARRAY[
        'admin', 'administrator', 'moderator', 'support', 'chessarena',
        'fuck', 'shit', 'bitch', 'asshole'
      ]) AS blocked(term)
      WHERE POSITION(blocked.term IN requested_username) > 0
    ) THEN
      RAISE EXCEPTION 'Username is not available' USING ERRCODE = '23514';
    END IF;

    username_candidate := requested_username;
    PERFORM pg_advisory_xact_lock(HASHTEXT(username_candidate));
    IF EXISTS (
      SELECT 1 FROM public.profiles
      WHERE LOWER(username) = username_candidate
    ) THEN
      RAISE EXCEPTION 'Username already taken' USING ERRCODE = '23505';
    END IF;
  ELSE
    username_base := LOWER(SPLIT_PART(COALESCE(NEW.email, ''), '@', 1));
    username_base := REGEXP_REPLACE(username_base, '[^a-z0-9_]', '', 'g');
    IF LENGTH(username_base) < 3 THEN
      username_base := 'player';
    END IF;
    username_base := LEFT(username_base, 14);
    IF EXISTS (
      SELECT 1
      FROM UNNEST(ARRAY[
        'admin', 'administrator', 'moderator', 'support', 'chessarena',
        'fuck', 'shit', 'bitch', 'asshole'
      ]) AS blocked(term)
      WHERE POSITION(blocked.term IN username_base) > 0
    ) THEN
      username_base := 'player';
    END IF;

    LOOP
      attempt := attempt + 1;
      collision_suffix := '_' || SUBSTRING(REPLACE(NEW.id::TEXT, '-', '') FROM 1 FOR 5);
      IF attempt > 1 THEN
        collision_suffix := '_' || SUBSTRING(MD5(NEW.id::TEXT || attempt::TEXT) FROM 1 FOR 5);
      END IF;
      username_candidate := LEFT(username_base, 20 - LENGTH(collision_suffix)) || collision_suffix;
      PERFORM pg_advisory_xact_lock(HASHTEXT(username_candidate));

      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE LOWER(username) = username_candidate
      );
      IF attempt >= 100 THEN
        RAISE EXCEPTION 'Unable to generate a unique username for the new account';
      END IF;
    END LOOP;
  END IF;

  INSERT INTO public.profiles (id, username, full_name, rating, preferences)
  VALUES (
    NEW.id,
    username_candidate,
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'Chess Player'),
    1200,
    '{"boardTheme": "dark", "pieceTheme": "standard", "soundEnabled": true}'::jsonb
  )
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.user_preferences (user_id, preferences)
  VALUES (
    NEW.id,
    '{"boardTheme": "dark", "pieceTheme": "standard", "soundEnabled": true}'::jsonb
  )
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE FUNCTION public.sync_profile_leaderboard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.leaderboard (
    user_id, username, rating, games_played, wins, losses, draws, win_rate, updated_at
  )
  VALUES (
    NEW.id,
    NEW.username,
    NEW.rating,
    NEW.games_played,
    NEW.wins,
    NEW.losses,
    NEW.draws,
    CASE WHEN NEW.games_played > 0
      THEN ROUND((NEW.wins::NUMERIC / NEW.games_played) * 100, 2)
      ELSE 0
    END,
    NOW()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    username = EXCLUDED.username,
    rating = EXCLUDED.rating,
    games_played = EXCLUDED.games_played,
    wins = EXCLUDED.wins,
    losses = EXCLUDED.losses,
    draws = EXCLUDED.draws,
    win_rate = EXCLUDED.win_rate,
    updated_at = EXCLUDED.updated_at;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_profile_leaderboard_created ON public.profiles;
CREATE TRIGGER on_profile_leaderboard_created
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_profile_leaderboard();

DROP TRIGGER IF EXISTS on_profile_leaderboard_updated ON public.profiles;
CREATE TRIGGER on_profile_leaderboard_updated
  AFTER UPDATE OF username, rating, games_played, wins, losses, draws ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_profile_leaderboard();

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

INSERT INTO public.leaderboard (
  user_id, username, rating, games_played, wins, losses, draws, win_rate, updated_at
)
SELECT
  id,
  username,
  rating,
  games_played,
  wins,
  losses,
  draws,
  CASE WHEN games_played > 0
    THEN ROUND((wins::NUMERIC / games_played) * 100, 2)
    ELSE 0
  END,
  NOW()
FROM public.profiles
ON CONFLICT (user_id) DO UPDATE SET
  username = EXCLUDED.username,
  rating = EXCLUDED.rating,
  games_played = EXCLUDED.games_played,
  wins = EXCLUDED.wins,
  losses = EXCLUDED.losses,
  draws = EXCLUDED.draws,
  win_rate = EXCLUDED.win_rate,
  updated_at = EXCLUDED.updated_at;
