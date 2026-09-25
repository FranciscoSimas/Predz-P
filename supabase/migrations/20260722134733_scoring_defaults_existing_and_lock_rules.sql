-- 1) Apply new scoring defaults to existing tournaments (outcome 2, exact +3)
UPDATE public.tournament_settings
SET
  points_outcome = 2,
  points_exact_bonus = 3
WHERE points_outcome = 1
  AND points_exact_bonus = 2;

-- 2) Lock scoring rules after the competition's first kickoff (defense in depth)
CREATE OR REPLACE FUNCTION public.lock_tournament_scoring_after_kickoff()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_started boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.tournaments t
    JOIN public.matches m ON m.competition_id = t.competition_id
    WHERE t.id = NEW.tournament_id
      AND (
        m.status IN ('live', 'finished')
        OR m.kickoff_at <= now()
      )
  ) INTO v_started;

  IF NOT v_started THEN
    RETURN NEW;
  END IF;

  IF NEW.points_outcome IS DISTINCT FROM OLD.points_outcome
     OR NEW.points_exact_bonus IS DISTINCT FROM OLD.points_exact_bonus
     OR NEW.wildcard_enabled IS DISTINCT FROM OLD.wildcard_enabled
     OR NEW.wildcard_per_round IS DISTINCT FROM OLD.wildcard_per_round
     OR NEW.wildcard_multiplier IS DISTINCT FROM OLD.wildcard_multiplier
     OR NEW.wildcard_scope IS DISTINCT FROM OLD.wildcard_scope
     OR NEW.win_streak_enabled IS DISTINCT FROM OLD.win_streak_enabled
     OR NEW.win_streak_threshold IS DISTINCT FROM OLD.win_streak_threshold
     OR NEW.win_streak_bonus IS DISTINCT FROM OLD.win_streak_bonus
     OR NEW.win_streak_mode IS DISTINCT FROM OLD.win_streak_mode
     OR NEW.special_bets_enabled IS DISTINCT FROM OLD.special_bets_enabled
     OR NEW.special_bet_winner_enabled IS DISTINCT FROM OLD.special_bet_winner_enabled
     OR NEW.special_bet_support_team_enabled IS DISTINCT FROM OLD.special_bet_support_team_enabled
     OR NEW.special_bet_top_scorer_enabled IS DISTINCT FROM OLD.special_bet_top_scorer_enabled
     OR NEW.special_bet_best_defense_enabled IS DISTINCT FROM OLD.special_bet_best_defense_enabled
     OR NEW.points_winner IS DISTINCT FROM OLD.points_winner
     OR NEW.points_support_advance IS DISTINCT FROM OLD.points_support_advance
     OR NEW.points_top_scorer IS DISTINCT FROM OLD.points_top_scorer
     OR NEW.points_best_defense IS DISTINCT FROM OLD.points_best_defense
     OR NEW.points_top_scorer_per_goal IS DISTINCT FROM OLD.points_top_scorer_per_goal
     OR NEW.top_scorer_mode IS DISTINCT FROM OLD.top_scorer_mode
     OR NEW.special_bets_cutoff_at IS DISTINCT FROM OLD.special_bets_cutoff_at
     OR NEW.winner_points_mode IS DISTINCT FROM OLD.winner_points_mode
  THEN
    RAISE EXCEPTION 'As regras de pontuação não podem ser alteradas depois do primeiro apito da competição.';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_lock_tournament_scoring_after_kickoff ON public.tournament_settings;
CREATE TRIGGER trg_lock_tournament_scoring_after_kickoff
  BEFORE UPDATE ON public.tournament_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.lock_tournament_scoring_after_kickoff();

REVOKE ALL ON FUNCTION public.lock_tournament_scoring_after_kickoff() FROM PUBLIC, anon, authenticated;
