-- Follow-up for projects where 20260716150000 was run manually in SQL Editor.

-- Remove the legacy six-argument overload. Keeping it alongside the new
-- defaulted knockout function makes six-argument RPC resolution ambiguous.
DROP FUNCTION IF EXISTS public.calc_prediction_points(
  integer, integer, integer, integer, integer, integer
);

ALTER FUNCTION public.calc_prediction_points(
  integer, integer, integer, integer, integer, integer,
  integer, integer, integer, integer, integer, integer,
  integer, integer, boolean
) SET search_path = pg_catalog;

-- Cover foreign keys reported by the Supabase performance advisor.
CREATE INDEX IF NOT EXISTS idx_special_bets_team_id
  ON public.special_bets(team_id)
  WHERE team_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_special_bets_user_id
  ON public.special_bets(user_id);

CREATE INDEX IF NOT EXISTS idx_tournament_member_streaks_user_id
  ON public.tournament_member_streaks(user_id);

CREATE INDEX IF NOT EXISTS idx_tournament_settings_best_defense
  ON public.tournament_settings(official_best_defense_team_id)
  WHERE official_best_defense_team_id IS NOT NULL;
