-- Improve catch-up detection: flag scheduled fixtures whose kickoff is far after
-- the round's first kickoff (original matchday cluster). The earlier
-- "last finished + 14d" rule missed Botafogo–Vitória because another catch-up
-- in the same round had already finished nearby.

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
  AND m.is_postponed = false
  AND m.kickoff_at > f.first_kick + interval '21 days';
