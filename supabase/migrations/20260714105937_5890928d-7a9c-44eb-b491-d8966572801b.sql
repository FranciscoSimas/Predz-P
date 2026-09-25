REVOKE EXECUTE ON FUNCTION public.recalc_tournament_streaks(uuid) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.recalc_special_bets(uuid) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.validate_wildcard_prediction() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.tournament_settings_after_update() FROM anon, authenticated, PUBLIC;