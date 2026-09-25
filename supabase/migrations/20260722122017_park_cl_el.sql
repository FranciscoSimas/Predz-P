-- Park UEFA CL + EL until official knockout/league setup is ready.
-- Pre-qualifiers were polluting matchday clusters and standings.

UPDATE public.competitions
SET is_active = false
WHERE slug IN ('champions-league-26-27', 'europa-league-26-27');

-- Official shells (0 predictions) — recreate later when calendar is ready
DELETE FROM public.tournaments
WHERE competition_id IN (
  SELECT id FROM public.competitions
  WHERE slug IN ('champions-league-26-27', 'europa-league-26-27')
);

DELETE FROM public.matches
WHERE competition_id IN (
  SELECT id FROM public.competitions
  WHERE slug IN ('champions-league-26-27', 'europa-league-26-27')
);

DELETE FROM public.competition_teams
WHERE competition_id IN (
  SELECT id FROM public.competitions
  WHERE slug IN ('champions-league-26-27', 'europa-league-26-27')
);

-- Drop planned/active sessions that may still reference deleted matches; rebuild
DELETE FROM public.sync_matchday_sessions
WHERE status IN ('planned', 'active');

SELECT public.rebuild_matchday_sessions(NULL);
