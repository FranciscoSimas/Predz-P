-- Platform admins need to read display names / avatars for the /admin Users tab.
-- Profiles are otherwise SELECT-own-only (see security_and_api_foundation).

DROP POLICY IF EXISTS "profiles read platform admin" ON public.profiles;
CREATE POLICY "profiles read platform admin"
  ON public.profiles FOR SELECT TO authenticated
  USING (private.is_platform_admin());

-- Distinct members with profile fields for the platform admin Users list.
CREATE OR REPLACE FUNCTION public.platform_admin_list_users()
RETURNS TABLE (
  user_id uuid,
  display_name text,
  avatar_url text,
  tournament_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticação necessária.';
  END IF;

  IF NOT private.is_platform_admin() THEN
    RAISE EXCEPTION 'Sem permissão.';
  END IF;

  RETURN QUERY
  SELECT
    tm.user_id,
    pr.display_name,
    pr.avatar_url,
    count(*)::bigint AS tournament_count
  FROM public.tournament_members tm
  LEFT JOIN public.profiles pr ON pr.id = tm.user_id
  GROUP BY tm.user_id, pr.display_name, pr.avatar_url
  ORDER BY lower(coalesce(pr.display_name, '')) ASC, tm.user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.platform_admin_list_users() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_admin_list_users() TO authenticated, service_role;
