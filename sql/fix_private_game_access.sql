-- Apply the participant-only game read policy and enable filtered realtime updates.
BEGIN;

ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public games select" ON public.games;
DROP POLICY IF EXISTS "Users insert games" ON public.games;
DROP POLICY IF EXISTS "Users update games" ON public.games;
DROP POLICY IF EXISTS "Game participants read games" ON public.games;
CREATE POLICY "Game participants read games" ON public.games FOR SELECT
  USING (auth.uid() = white_player_id OR auth.uid() = black_player_id);

REVOKE SELECT ON public.games FROM PUBLIC, anon;
GRANT SELECT ON public.games TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) THEN
    RAISE EXCEPTION 'Supabase realtime publication was not found; enable Realtime for public.games in Supabase.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'games'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.games';
  END IF;
END;
$$;

COMMIT;
