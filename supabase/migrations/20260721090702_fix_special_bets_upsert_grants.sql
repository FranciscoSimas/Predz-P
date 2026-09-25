-- Fix special_bets client upsert: PostgREST ON CONFLICT updates all payload
-- columns (incl. tournament_id / user_id). Column UPDATE grants were incomplete
-- after harden_scoring_security_perf, causing "permission denied for table special_bets".

REVOKE ALL ON TABLE public.special_bets FROM anon;

REVOKE INSERT, UPDATE ON TABLE public.special_bets FROM authenticated;

GRANT SELECT, DELETE ON TABLE public.special_bets TO authenticated;

GRANT INSERT (
  tournament_id,
  user_id,
  bet_type,
  value,
  team_id
) ON public.special_bets TO authenticated;

GRANT UPDATE (
  tournament_id,
  user_id,
  bet_type,
  value,
  team_id
) ON public.special_bets TO authenticated;
-- points / id / created_at / updated_at remain server-only
