-- Postponed / catch-up matches: stay scheduled, flag for UI + jornada current.

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS is_postponed boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.matches.is_postponed IS
  'True once postponed (API PST/POSTPONED or backfill). Kept through reschedule; cleared on finished.';

-- Stale: still scheduled with kickoff long in the past (e.g. Flamengo–Mirassol).
UPDATE public.matches
SET is_postponed = true
WHERE status = 'scheduled'
  AND kickoff_at < now() - interval '3 days';

-- Catch-up reschedule: still scheduled long after the round's first kickoff
-- (original matchday cluster), e.g. Botafogo–Vitória jornada 4 moved into July.
UPDATE public.matches m
SET is_postponed = true
FROM (
  SELECT competition_id, round_or_matchday, min(kickoff_at) AS first_kick
  FROM public.matches
  WHERE round_or_matchday IS NOT NULL
  GROUP BY competition_id, round_or_matchday
) f
WHERE m.competition_id = f.competition_id
  AND m.round_or_matchday = f.round_or_matchday
  AND m.status = 'scheduled'
  AND m.kickoff_at > f.first_kick + interval '21 days';
