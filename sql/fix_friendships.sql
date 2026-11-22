-- Repair friendship requests and prevent duplicate or reverse-direction requests.
-- Safe to rerun. This migration does not delete existing friendships.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'friendships_not_self'
      AND conrelid = 'public.friendships'::regclass
  ) THEN
    ALTER TABLE public.friendships
      ADD CONSTRAINT friendships_not_self CHECK (user_id <> friend_id);
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.friendships
    GROUP BY
      LEAST(user_id::text, friend_id::text),
      GREATEST(user_id::text, friend_id::text)
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot create canonical friendship uniqueness: resolve duplicate forward/reverse friendship rows first';
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_friendships_canonical_pair
  ON public.friendships (
    ((LEAST(user_id::text, friend_id::text))),
    ((GREATEST(user_id::text, friend_id::text)))
  );

ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own friendships" ON public.friendships;
CREATE POLICY "Users read own friendships" ON public.friendships FOR SELECT
  USING (auth.uid() = user_id OR auth.uid() = friend_id);

DROP POLICY IF EXISTS "Users create own friendships" ON public.friendships;
CREATE POLICY "Users create own friendships" ON public.friendships FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND user_id <> friend_id
    AND status = 'pending'
  );

DROP POLICY IF EXISTS "Participants update friendships" ON public.friendships;
CREATE POLICY "Participants update friendships" ON public.friendships FOR UPDATE
  USING (auth.uid() = friend_id AND status = 'pending')
  WITH CHECK (auth.uid() = friend_id AND status IN ('accepted', 'blocked'));

REVOKE ALL ON public.friendships FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.friendships TO authenticated;
GRANT INSERT ON public.friendships TO authenticated;
GRANT UPDATE (status) ON public.friendships TO authenticated;

CREATE OR REPLACE FUNCTION public.send_friend_request(p_friend_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  requesting_user UUID := auth.uid();
  existing_friendship public.friendships%ROWTYPE;
BEGIN
  IF requesting_user IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;
  IF p_friend_id IS NULL OR p_friend_id = requesting_user THEN
    RAISE EXCEPTION 'Choose another player' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_friend_id) THEN
    RAISE EXCEPTION 'Player not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO existing_friendship
  FROM public.friendships
  WHERE (
    (user_id = requesting_user AND friend_id = p_friend_id)
    OR
    (user_id = p_friend_id AND friend_id = requesting_user)
  )
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    IF existing_friendship.status = 'accepted' THEN
      RETURN jsonb_build_object('status', 'already_friends');
    END IF;
    IF existing_friendship.status = 'blocked' THEN
      RAISE EXCEPTION 'Friend request is unavailable' USING ERRCODE = '42501';
    END IF;
    IF existing_friendship.friend_id = requesting_user THEN
      RETURN jsonb_build_object('status', 'incoming_request', 'relationshipId', existing_friendship.id);
    END IF;
    RETURN jsonb_build_object('status', 'already_requested', 'relationshipId', existing_friendship.id);
  END IF;

  INSERT INTO public.friendships (user_id, friend_id, status)
  VALUES (requesting_user, p_friend_id, 'pending')
  RETURNING id INTO existing_friendship.id;

  RETURN jsonb_build_object('status', 'requested', 'relationshipId', existing_friendship.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.respond_friend_request(p_relationship_id UUID, p_accept BOOLEAN)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  requesting_user UUID := auth.uid();
  relationship public.friendships%ROWTYPE;
BEGIN
  IF requesting_user IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;
  IF p_relationship_id IS NULL OR p_accept IS NULL THEN
    RAISE EXCEPTION 'Invalid friend response' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO relationship
  FROM public.friendships
  WHERE id = p_relationship_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Friend request not found' USING ERRCODE = 'P0002';
  END IF;
  IF relationship.friend_id <> requesting_user THEN
    RAISE EXCEPTION 'Only the recipient can respond' USING ERRCODE = '42501';
  END IF;
  IF relationship.status <> 'pending' THEN
    RETURN jsonb_build_object('status', relationship.status);
  END IF;

  IF p_accept THEN
    UPDATE public.friendships
    SET status = 'accepted'
    WHERE id = p_relationship_id;
  ELSE
    DELETE FROM public.friendships
    WHERE id = p_relationship_id;
  END IF;

  RETURN jsonb_build_object('status', CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END);
END;
$$;

REVOKE ALL ON FUNCTION public.send_friend_request(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.respond_friend_request(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_friend_request(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_friend_request(UUID, BOOLEAN) TO authenticated;
