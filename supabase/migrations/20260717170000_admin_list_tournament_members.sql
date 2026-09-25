-- Admin member list with display names (no FK tournament_members → profiles).
CREATE OR REPLACE FUNCTION public.admin_list_tournament_members(_tournament_id uuid)
RETURNS TABLE (
  user_id uuid,
  role public.tournament_role,
  joined_at timestamptz,
  display_name text,
  avatar_url text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticação necessária.';
  END IF;

  IF NOT (
    private.is_tournament_admin(_tournament_id)
    OR private.is_platform_admin()
  ) THEN
    RAISE EXCEPTION 'Sem permissão para gerir membros.';
  END IF;

  RETURN QUERY
  SELECT
    tm.user_id,
    tm.role,
    tm.joined_at,
    pr.display_name,
    pr.avatar_url
  FROM public.tournament_members tm
  LEFT JOIN public.profiles pr ON pr.id = tm.user_id
  WHERE tm.tournament_id = _tournament_id
  ORDER BY
    CASE tm.role
      WHEN 'owner' THEN 0
      WHEN 'admin' THEN 1
      ELSE 2
    END,
    tm.joined_at;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_tournament_members(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_tournament_members(uuid) TO authenticated, service_role;
