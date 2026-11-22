-- Repair instant, atomic, Elo-independent matchmaking.
-- Safe to rerun. Existing queue/game rows are preserved.

ALTER TABLE public.matchmaking_queue
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS game_mode TEXT NOT NULL DEFAULT 'standard';

UPDATE public.matchmaking_queue
SET expires_at = COALESCE(expires_at, joined_at + INTERVAL '10 minutes')
WHERE expires_at IS NULL;

ALTER TABLE public.matchmaking_queue
  ALTER COLUMN expires_at SET DEFAULT (NOW() + INTERVAL '10 minutes');

CREATE INDEX IF NOT EXISTS idx_matchmaking_waiting_instant
  ON public.matchmaking_queue(time_control, joined_at)
  WHERE status = 'queued';

ALTER TABLE public.matchmaking_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own matchmaking queue" ON public.matchmaking_queue;
CREATE POLICY "Users read own matchmaking queue" ON public.matchmaking_queue
  FOR SELECT USING (auth.uid() = user_id);

REVOKE ALL ON public.matchmaking_queue FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.matchmaking_queue TO authenticated;

CREATE OR REPLACE FUNCTION public.join_matchmaking(p_time_control TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  requesting_user UUID := auth.uid();
  own_entry public.matchmaking_queue%ROWTYPE;
  opponent public.matchmaking_queue%ROWTYPE;
  opponent_profile public.profiles%ROWTYPE;
  own_profile public.profiles%ROWTYPE;
  created_game_id UUID;
  white_id UUID;
  black_id UUID;
BEGIN
  IF requesting_user IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;
  IF p_time_control IS NULL OR p_time_control NOT IN (
    '1+0', '3+0', '3+2', '5+0', '10+0', '10+5', '15+10'
  ) THEN
    RAISE EXCEPTION 'Unsupported time control' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('chessarena-matchmaking'));

  DELETE FROM public.matchmaking_queue
  WHERE status = 'queued'
    AND expires_at IS NOT NULL
    AND expires_at <= NOW();

  DELETE FROM public.matchmaking_queue
  WHERE status = 'matched'
    AND (
      game_id IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM public.games
        WHERE games.id = matchmaking_queue.game_id
          AND games.status = 'in_progress'
          AND games.result = 'in_progress'
      )
    );

  IF EXISTS (
    SELECT 1 FROM public.games
    WHERE status = 'in_progress'
      AND result = 'in_progress'
      AND (white_player_id = requesting_user OR black_player_id = requesting_user)
  ) THEN
    RAISE EXCEPTION 'You are already in an active game' USING ERRCODE = '40001';
  END IF;

  SELECT * INTO own_entry
  FROM public.matchmaking_queue
  WHERE user_id = requesting_user
  FOR UPDATE;

  IF FOUND AND own_entry.status = 'matched' THEN
    IF own_entry.game_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.games
      WHERE id = own_entry.game_id
        AND status = 'in_progress'
        AND result = 'in_progress'
    ) THEN
      RETURN jsonb_build_object('status', 'matched', 'gameId', own_entry.game_id);
    END IF;
    DELETE FROM public.matchmaking_queue WHERE user_id = requesting_user;
  ELSIF FOUND THEN
    UPDATE public.matchmaking_queue
    SET time_control = p_time_control,
        joined_at = CASE
          WHEN time_control = p_time_control THEN joined_at
          ELSE NOW()
        END,
        expires_at = NOW() + INTERVAL '10 minutes'
    WHERE user_id = requesting_user
    RETURNING * INTO own_entry;

    SELECT * INTO opponent
    FROM public.matchmaking_queue AS candidate
    WHERE candidate.status = 'queued'
      AND candidate.time_control = p_time_control
      AND candidate.user_id <> requesting_user
      AND candidate.expires_at > NOW()
      AND NOT EXISTS (
        SELECT 1 FROM public.games
        WHERE status = 'in_progress'
          AND result = 'in_progress'
          AND (white_player_id = candidate.user_id
            OR black_player_id = candidate.user_id)
      )
    ORDER BY candidate.joined_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED;
  ELSE
    INSERT INTO public.matchmaking_queue (
      user_id, time_control, status, game_mode, joined_at, expires_at
    )
    VALUES (
      requesting_user, p_time_control, 'queued', 'standard', NOW(), NOW() + INTERVAL '10 minutes'
    )
    RETURNING * INTO own_entry;

    SELECT * INTO opponent
    FROM public.matchmaking_queue AS candidate
    WHERE candidate.status = 'queued'
      AND candidate.time_control = p_time_control
      AND candidate.user_id <> requesting_user
      AND candidate.expires_at > NOW()
      AND NOT EXISTS (
        SELECT 1 FROM public.games
        WHERE status = 'in_progress'
          AND result = 'in_progress'
          AND (white_player_id = candidate.user_id
            OR black_player_id = candidate.user_id)
      )
    ORDER BY candidate.joined_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED;
  END IF;

  IF NOT FOUND OR opponent.user_id IS NULL THEN
    RETURN jsonb_build_object('status', 'queued');
  END IF;

  SELECT * INTO own_profile FROM public.profiles WHERE id = requesting_user;
  SELECT * INTO opponent_profile FROM public.profiles WHERE id = opponent.user_id;

  IF NOT FOUND OR own_profile.id IS NULL OR opponent_profile.id IS NULL THEN
    RAISE EXCEPTION 'A matchmaking player profile is missing' USING ERRCODE = '23503';
  END IF;

  IF random() < 0.5 THEN
    white_id := opponent.user_id;
    black_id := requesting_user;
  ELSE
    white_id := requesting_user;
    black_id := opponent.user_id;
  END IF;

  INSERT INTO public.games (
    white_player_id, black_player_id,
    white_rating, black_rating,
    time_control, status, result, moves, fen
  )
  VALUES (
    white_id,
    black_id,
    CASE WHEN white_id = opponent.user_id THEN opponent_profile.rating ELSE own_profile.rating END,
    CASE WHEN black_id = opponent.user_id THEN opponent_profile.rating ELSE own_profile.rating END,
    p_time_control,
    'in_progress',
    'in_progress',
    '[]'::jsonb,
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
  )
  RETURNING id INTO created_game_id;

  UPDATE public.matchmaking_queue
  SET status = 'matched',
      game_id = created_game_id,
      expires_at = NOW() + INTERVAL '10 minutes'
  WHERE user_id = opponent.user_id;

  INSERT INTO public.matchmaking_queue (
    user_id, time_control, status, game_mode, game_id, joined_at, expires_at
  )
  VALUES (
    requesting_user, p_time_control, 'matched', 'standard',
    created_game_id, NOW(), NOW() + INTERVAL '10 minutes'
  )
  ON CONFLICT (user_id) DO UPDATE
  SET status = 'matched',
      time_control = EXCLUDED.time_control,
      game_mode = EXCLUDED.game_mode,
      game_id = EXCLUDED.game_id,
      joined_at = EXCLUDED.joined_at,
      expires_at = EXCLUDED.expires_at;

  RETURN jsonb_build_object('status', 'matched', 'gameId', created_game_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.matchmaking_status()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  requesting_user UUID := auth.uid();
  queue_entry public.matchmaking_queue%ROWTYPE;
BEGIN
  IF requesting_user IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('chessarena-matchmaking'));

  DELETE FROM public.matchmaking_queue
  WHERE user_id = requesting_user
    AND status = 'queued'
    AND expires_at IS NOT NULL
    AND expires_at <= NOW();

  SELECT * INTO queue_entry
  FROM public.matchmaking_queue
  WHERE user_id = requesting_user
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'idle');
  END IF;

  IF queue_entry.status = 'matched' THEN
    IF queue_entry.game_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.games
      WHERE id = queue_entry.game_id
        AND status = 'in_progress'
        AND result = 'in_progress'
    ) THEN
      RETURN jsonb_build_object('status', 'matched', 'gameId', queue_entry.game_id);
    END IF;
    DELETE FROM public.matchmaking_queue WHERE user_id = requesting_user;
    RETURN jsonb_build_object('status', 'idle');
  END IF;

  IF queue_entry.expires_at <= NOW() THEN
    DELETE FROM public.matchmaking_queue WHERE user_id = requesting_user;
    RETURN jsonb_build_object('status', 'idle');
  END IF;

  RETURN jsonb_build_object('status', 'queued');
END;
$$;

CREATE OR REPLACE FUNCTION public.leave_matchmaking()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  requesting_user UUID := auth.uid();
BEGIN
  IF requesting_user IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  DELETE FROM public.matchmaking_queue
  WHERE user_id = requesting_user
    AND status = 'queued';

  RETURN jsonb_build_object('status', 'idle');
END;
$$;

REVOKE ALL ON FUNCTION public.join_matchmaking(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.matchmaking_status() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.leave_matchmaking() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_matchmaking(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.matchmaking_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.leave_matchmaking() TO authenticated;
