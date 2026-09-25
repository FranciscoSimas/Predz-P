-- Allow seeing own membership + members of public tournaments (fixes Explore count = 0).
DROP POLICY IF EXISTS "tm select if in same tournament" ON public.tournament_members;

CREATE POLICY "tm select own, co-members, or public"
  ON public.tournament_members FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR private.is_tournament_member(tournament_id)
    OR private.is_public_tournament(tournament_id)
  );

-- Reliable public join path (avoids upsert/RETURNING RLS edge cases).
CREATE OR REPLACE FUNCTION public.join_public_tournament(_tournament_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_public boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Autenticação necessária.';
  END IF;

  SELECT t.is_public INTO v_public
  FROM public.tournaments t
  WHERE t.id = _tournament_id;

  IF v_public IS NULL THEN
    RAISE EXCEPTION 'Torneio não encontrado.';
  END IF;

  IF NOT v_public THEN
    RAISE EXCEPTION 'Este torneio não é público. Usa o código de convite.';
  END IF;

  INSERT INTO public.tournament_members (tournament_id, user_id, role)
  VALUES (_tournament_id, v_uid, 'member')
  ON CONFLICT (tournament_id, user_id) DO NOTHING;

  RETURN _tournament_id;
END;
$$;

REVOKE ALL ON FUNCTION public.join_public_tournament(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_public_tournament(uuid) TO authenticated, service_role;
