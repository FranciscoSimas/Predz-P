-- The event trigger must run internally, not as an exposed PostgREST RPC.
REVOKE ALL ON FUNCTION public.rls_auto_enable()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rls_auto_enable()
  TO service_role;
