-- Add durable tournament rounds and matches.
-- Safe to rerun; does not modify existing tournament registrations or results.

CREATE TABLE IF NOT EXISTS public.tournament_rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL CHECK (round_number >= 1),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  UNIQUE (tournament_id, round_number)
);

CREATE TABLE IF NOT EXISTS public.tournament_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id UUID NOT NULL REFERENCES public.tournament_rounds(id) ON DELETE CASCADE,
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  white_player_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  black_player_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  game_id UUID REFERENCES public.games(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (round_id, white_player_id, black_player_id)
);

CREATE INDEX IF NOT EXISTS idx_tournament_rounds_tournament
  ON public.tournament_rounds(tournament_id, round_number DESC);
CREATE INDEX IF NOT EXISTS idx_tournament_matches_round
  ON public.tournament_matches(round_id);
CREATE INDEX IF NOT EXISTS idx_tournament_matches_game
  ON public.tournament_matches(game_id);

ALTER TABLE public.tournament_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_matches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tournament rounds public read" ON public.tournament_rounds;
CREATE POLICY "Tournament rounds public read" ON public.tournament_rounds
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Tournament matches public read" ON public.tournament_matches;
CREATE POLICY "Tournament matches public read" ON public.tournament_matches
  FOR SELECT USING (true);

REVOKE ALL ON public.tournament_rounds, public.tournament_matches FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.tournament_rounds, public.tournament_matches TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.start_tournament_round(p_tournament_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  requesting_user UUID := auth.uid();
  selected_tournament public.tournaments%ROWTYPE;
  participant_ids UUID[];
  participant_count INTEGER;
  next_round_number INTEGER;
  round_id UUID;
  index_value INTEGER;
  white_id UUID;
  black_id UUID;
  white_rating INTEGER;
  black_rating INTEGER;
  created_game_id UUID;
  match_count INTEGER := 0;
BEGIN
  IF requesting_user IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO selected_tournament
  FROM public.tournaments
  WHERE id = p_tournament_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tournament not found' USING ERRCODE = 'P0002';
  END IF;
  IF requesting_user <> selected_tournament.organizer_id THEN
    RAISE EXCEPTION 'Only the tournament organizer can start a round' USING ERRCODE = '42501';
  END IF;
  IF selected_tournament.status = 'completed' THEN
    RAISE EXCEPTION 'Tournament is already completed' USING ERRCODE = '40001';
  END IF;
  IF selected_tournament.format NOT IN ('swiss', 'round_robin') THEN
    RAISE EXCEPTION 'Round generation is currently supported for Swiss and round-robin tournaments'
      USING ERRCODE = '0A000';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.tournament_rounds
    WHERE tournament_id = p_tournament_id
      AND status = 'open'
  ) THEN
    RAISE EXCEPTION 'Complete the open tournament round before starting another'
      USING ERRCODE = '40001';
  END IF;

  SELECT ARRAY_AGG(participant.user_id ORDER BY COALESCE(participant.score, 0) DESC,
                   COALESCE(profile.rating, 1200) DESC, participant.joined_at ASC),
         COUNT(*)
  INTO participant_ids, participant_count
  FROM public.tournament_players AS participant
  JOIN public.profiles AS profile ON profile.id = participant.user_id
  WHERE participant.tournament_id = p_tournament_id;

  IF participant_count < 2 THEN
    RAISE EXCEPTION 'At least two registered players are required' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(MAX(round_number), 0) + 1
  INTO next_round_number
  FROM public.tournament_rounds
  WHERE tournament_id = p_tournament_id;

  INSERT INTO public.tournament_rounds (tournament_id, round_number, status)
  VALUES (p_tournament_id, next_round_number, 'open')
  RETURNING id INTO round_id;

  index_value := 1;
  WHILE index_value <= participant_count LOOP
    white_id := participant_ids[index_value];
    black_id := CASE WHEN index_value < participant_count THEN participant_ids[index_value + 1] ELSE NULL END;

    IF black_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1
        FROM public.tournament_matches AS previous_match
        JOIN public.tournament_rounds AS previous_round
          ON previous_round.id = previous_match.round_id
        WHERE previous_match.tournament_id = p_tournament_id
          AND (
            (previous_match.white_player_id = white_id AND previous_match.black_player_id = black_id)
            OR
            (previous_match.white_player_id = black_id AND previous_match.black_player_id = white_id)
          )
      ) THEN
        SELECT COALESCE(rating, 1200) INTO white_rating
        FROM public.profiles WHERE id = white_id;
        SELECT COALESCE(rating, 1200) INTO black_rating
        FROM public.profiles WHERE id = black_id;

        INSERT INTO public.games (
          white_player_id, black_player_id, white_rating, black_rating,
          time_control, status, result
        )
        VALUES (
          white_id, black_id, COALESCE(white_rating, 1200), COALESCE(black_rating, 1200),
          selected_tournament.time_control, 'in_progress', 'in_progress'
        )
        RETURNING id INTO created_game_id;

        INSERT INTO public.tournament_matches (
          round_id, tournament_id, white_player_id, black_player_id, game_id, status
        )
        VALUES (
          round_id, p_tournament_id, white_id, black_id, created_game_id, 'in_progress'
        );
        match_count := match_count + 1;
      END IF;
    END IF;

    index_value := index_value + 2;
  END LOOP;

  UPDATE public.tournaments
  SET status = 'live'
  WHERE id = p_tournament_id;

  RETURN jsonb_build_object(
    'status', 'started',
    'roundId', round_id,
    'roundNumber', next_round_number,
    'matchCount', match_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.start_tournament_round(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_tournament_round(UUID) TO authenticated;
