-- Support team scoring mode: per_phase (default) | champion (flat points if champion)

ALTER TABLE public.tournament_settings
  ADD COLUMN IF NOT EXISTS support_team_mode TEXT NOT NULL DEFAULT 'per_phase';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tournament_settings_support_team_mode_check'
  ) THEN
    ALTER TABLE public.tournament_settings
      ADD CONSTRAINT tournament_settings_support_team_mode_check
      CHECK (support_team_mode IN ('per_phase', 'champion'));
  END IF;
END $$;

COMMENT ON COLUMN public.tournament_settings.support_team_mode IS
  'per_phase: X pts per knockout advance (+X if champion). champion: flat X pts only if champion.';

-- Lock after kickoff
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
     OR NEW.support_team_mode IS DISTINCT FROM OLD.support_team_mode
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

-- Recalc when mode changes
CREATE OR REPLACE FUNCTION public.tournament_settings_after_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.official_winner_team_id IS DISTINCT FROM OLD.official_winner_team_id
     OR NEW.official_top_scorer IS DISTINCT FROM OLD.official_top_scorer
     OR NEW.official_best_defense_team_id IS DISTINCT FROM OLD.official_best_defense_team_id
     OR NEW.official_top_scorer_goals IS DISTINCT FROM OLD.official_top_scorer_goals
     OR NEW.official_top_scorer_external_id IS DISTINCT FROM OLD.official_top_scorer_external_id
     OR NEW.points_winner IS DISTINCT FROM OLD.points_winner
     OR NEW.points_top_scorer IS DISTINCT FROM OLD.points_top_scorer
     OR NEW.points_best_defense IS DISTINCT FROM OLD.points_best_defense
     OR NEW.points_top_scorer_per_goal IS DISTINCT FROM OLD.points_top_scorer_per_goal
     OR NEW.top_scorer_mode IS DISTINCT FROM OLD.top_scorer_mode
     OR NEW.special_bets_enabled IS DISTINCT FROM OLD.special_bets_enabled
     OR NEW.special_bet_winner_enabled IS DISTINCT FROM OLD.special_bet_winner_enabled
     OR NEW.special_bet_top_scorer_enabled IS DISTINCT FROM OLD.special_bet_top_scorer_enabled
     OR NEW.special_bet_best_defense_enabled IS DISTINCT FROM OLD.special_bet_best_defense_enabled
     OR NEW.special_bet_support_team_enabled IS DISTINCT FROM OLD.special_bet_support_team_enabled
     OR NEW.points_support_advance IS DISTINCT FROM OLD.points_support_advance
     OR NEW.support_team_mode IS DISTINCT FROM OLD.support_team_mode THEN
    PERFORM public.recalc_special_bets(NEW.tournament_id);
  END IF;

  IF NEW.win_streak_enabled IS DISTINCT FROM OLD.win_streak_enabled
     OR NEW.win_streak_threshold IS DISTINCT FROM OLD.win_streak_threshold
     OR NEW.win_streak_bonus IS DISTINCT FROM OLD.win_streak_bonus THEN
    PERFORM public.recalc_tournament_streaks(NEW.tournament_id);
  END IF;

  RETURN NEW;
END;
$$;

-- Support team scoring respects support_team_mode
CREATE OR REPLACE FUNCTION public.recalc_special_bets(_tournament_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings public.tournament_settings%ROWTYPE;
  v_comp UUID;
  r RECORD;
  v_advances INT;
  v_x INT;
  v_champ BOOLEAN;
  v_pts INT;
  v_mode TEXT;
BEGIN
  SELECT ts.* INTO v_settings
  FROM public.tournament_settings ts
  WHERE ts.tournament_id = _tournament_id;

  IF NOT FOUND OR NOT COALESCE(v_settings.special_bets_enabled, false) THEN
    UPDATE public.special_bets SET points = 0, updated_at = now()
    WHERE tournament_id = _tournament_id;
    PERFORM public.refresh_member_special_bets_points(_tournament_id, tm.user_id)
    FROM public.tournament_members tm
    WHERE tm.tournament_id = _tournament_id;
    RETURN;
  END IF;

  SELECT t.competition_id INTO v_comp
  FROM public.tournaments t
  WHERE t.id = _tournament_id;

  UPDATE public.special_bets sb
  SET points = CASE
    WHEN v_settings.special_bet_winner_enabled AND v_settings.official_winner_team_id IS NOT NULL
      AND sb.team_id = v_settings.official_winner_team_id
    THEN COALESCE(v_settings.points_winner, 0) ELSE 0 END,
    updated_at = now()
  WHERE sb.tournament_id = _tournament_id AND sb.bet_type = 'winner';

  UPDATE public.special_bets sb
  SET points = CASE
    WHEN v_settings.special_bet_top_scorer_enabled AND v_settings.official_top_scorer IS NOT NULL
      AND lower(trim(sb.value)) = lower(trim(v_settings.official_top_scorer))
    THEN CASE WHEN v_settings.top_scorer_mode = 'per_goal'
      THEN COALESCE(v_settings.official_top_scorer_goals, 0) * COALESCE(v_settings.points_top_scorer_per_goal, 1)
      ELSE COALESCE(v_settings.points_top_scorer, 0) END
    ELSE 0 END,
    updated_at = now()
  WHERE sb.tournament_id = _tournament_id AND sb.bet_type = 'top_scorer';

  UPDATE public.special_bets sb
  SET points = CASE
    WHEN v_settings.special_bet_best_defense_enabled AND v_settings.official_best_defense_team_id IS NOT NULL
      AND sb.team_id = v_settings.official_best_defense_team_id
    THEN COALESCE(v_settings.points_best_defense, 0) ELSE 0 END,
    updated_at = now()
  WHERE sb.tournament_id = _tournament_id AND sb.bet_type = 'best_defense';

  v_x := GREATEST(COALESCE(v_settings.points_support_advance, 0), 0);
  v_mode := COALESCE(v_settings.support_team_mode, 'per_phase');

  FOR r IN
    SELECT sb.id, sb.team_id, sb.user_id
    FROM public.special_bets sb
    WHERE sb.tournament_id = _tournament_id AND sb.bet_type = 'support_team'
  LOOP
    IF NOT COALESCE(v_settings.special_bet_support_team_enabled, false) OR r.team_id IS NULL THEN
      v_pts := 0;
    ELSE
      v_champ := (
        v_settings.official_winner_team_id IS NOT NULL AND r.team_id = v_settings.official_winner_team_id
      ) OR EXISTS (
        SELECT 1 FROM public.matches m
        WHERE m.competition_id = v_comp
          AND m.status = 'finished'
          AND lower(COALESCE(m.phase, '')) = 'final'
          AND private.match_winning_team_id(
            m.home_team_id, m.away_team_id,
            m.home_score, m.away_score,
            m.et_home_score, m.et_away_score,
            m.pen_home_score, m.pen_away_score
          ) = r.team_id
      );

      IF v_mode = 'champion' THEN
        v_pts := CASE WHEN v_champ THEN v_x ELSE 0 END;
      ELSE
        v_advances := private.count_support_team_advances(v_comp, r.team_id);
        v_pts := (v_advances * v_x) + (CASE WHEN v_champ THEN v_x ELSE 0 END);
      END IF;
    END IF;

    UPDATE public.special_bets
    SET points = v_pts, updated_at = now()
    WHERE id = r.id;
  END LOOP;

  PERFORM public.refresh_member_special_bets_points(_tournament_id, tm.user_id)
  FROM public.tournament_members tm
  WHERE tm.tournament_id = _tournament_id;
END;
$$;
