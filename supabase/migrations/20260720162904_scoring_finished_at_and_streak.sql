-- =============================================================================
-- Scoring modules: finished_at, win streak (missing breaks), support_team bets
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. matches.finished_at — real end time for streak ordering
-- -----------------------------------------------------------------------------
ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ;

COMMENT ON COLUMN public.matches.finished_at IS
  'When the match became finished (wall clock). Used for win-streak order when kickoffs tie.';

CREATE OR REPLACE FUNCTION public.set_match_finished_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'finished' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'finished') THEN
    IF NEW.finished_at IS NULL THEN
      NEW.finished_at := now();
    END IF;
  ELSIF NEW.status IS DISTINCT FROM 'finished' THEN
    NEW.finished_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_match_finished_at ON public.matches;
CREATE TRIGGER trg_set_match_finished_at
  BEFORE INSERT OR UPDATE OF status, finished_at ON public.matches
  FOR EACH ROW EXECUTE FUNCTION public.set_match_finished_at();

UPDATE public.matches
SET finished_at = COALESCE(updated_at, kickoff_at)
WHERE status = 'finished' AND finished_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_matches_comp_finished_order
  ON public.matches (competition_id, kickoff_at, finished_at)
  WHERE status = 'finished';

-- -----------------------------------------------------------------------------
-- 2. Win streak: finished matches of competition; missing prediction breaks
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recalc_tournament_streaks(_tournament_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s RECORD;
  u RECORD;
  cur INT;
  best INT;
  bonus INT;
  v_threshold INT;
  v_bonus INT;
  v_enabled BOOLEAN;
  v_comp UUID;
BEGIN
  SELECT ts.win_streak_enabled, ts.win_streak_threshold, ts.win_streak_bonus, t.competition_id
  INTO v_enabled, v_threshold, v_bonus, v_comp
  FROM public.tournament_settings ts
  JOIN public.tournaments t ON t.id = ts.tournament_id
  WHERE ts.tournament_id = _tournament_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF NOT COALESCE(v_enabled, false) THEN
    UPDATE public.tournament_member_streaks
    SET current_streak = 0, bonus_points = 0, updated_at = now()
    WHERE tournament_id = _tournament_id;
    RETURN;
  END IF;

  FOR u IN
    SELECT DISTINCT user_id FROM public.tournament_members WHERE tournament_id = _tournament_id
  LOOP
    cur := 0;
    best := 0;
    bonus := 0;

    FOR s IN
      SELECT COALESCE(p.points, 0) AS points,
             (p.id IS NOT NULL) AS has_pred
      FROM public.matches m
      LEFT JOIN public.predictions p
        ON p.match_id = m.id
       AND p.tournament_id = _tournament_id
       AND p.user_id = u.user_id
      WHERE m.competition_id = v_comp
        AND m.status = 'finished'
      ORDER BY m.kickoff_at ASC, m.finished_at ASC NULLS LAST, m.id ASC
    LOOP
      IF NOT s.has_pred OR s.points <= 0 THEN
        cur := 0;
      ELSE
        cur := cur + 1;
        IF cur > best THEN
          best := cur;
        END IF;
        IF v_threshold > 0 AND cur % v_threshold = 0 THEN
          bonus := bonus + COALESCE(v_bonus, 0);
        END IF;
      END IF;
    END LOOP;

    INSERT INTO public.tournament_member_streaks (
      tournament_id, user_id, current_streak, best_streak, bonus_points, updated_at
    )
    VALUES (_tournament_id, u.user_id, cur, best, bonus, now())
    ON CONFLICT (tournament_id, user_id) DO UPDATE
    SET current_streak = EXCLUDED.current_streak,
        best_streak = GREATEST(public.tournament_member_streaks.best_streak, EXCLUDED.best_streak),
        bonus_points = EXCLUDED.bonus_points,
        updated_at = now();
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.recalc_tournament_streaks(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recalc_tournament_streaks(UUID) TO service_role;

-- -----------------------------------------------------------------------------
-- 3. Special bet: support_team + settings
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'special_bet_type' AND e.enumlabel = 'support_team'
  ) THEN
    ALTER TYPE public.special_bet_type ADD VALUE 'support_team';
  END IF;
END $$;

ALTER TABLE public.tournament_settings
  ADD COLUMN IF NOT EXISTS special_bet_support_team_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS points_support_advance INT NOT NULL DEFAULT 3;

COMMENT ON COLUMN public.tournament_settings.points_support_advance IS
  'X points per knockout advance for support_team bets; same X added again if team is champion.';

-- -----------------------------------------------------------------------------
-- 4. Helpers: knockout match + winning team
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.is_knockout_bracket_phase(_phase text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN _phase IS NULL THEN false
    WHEN lower(_phase) IN (
      'round_of_16', 'quarter_finals', 'semi_finals', 'final',
      'last_16', 'last16', 'quarter-finals', 'semi-finals'
    ) THEN true
    WHEN lower(_phase) LIKE '%round_of%' OR lower(_phase) LIKE '%last_1%' THEN true
    WHEN lower(_phase) LIKE '%quarter%' OR lower(_phase) LIKE '%semi%' THEN true
    WHEN lower(_phase) = 'final' OR (lower(_phase) LIKE '%final%'
      AND lower(_phase) NOT LIKE '%semi%'
      AND lower(_phase) NOT LIKE '%third%'
      AND lower(_phase) NOT LIKE '%league%') THEN true
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION private.match_winning_team_id(
  _home_team_id uuid,
  _away_team_id uuid,
  _home_score int,
  _away_score int,
  _et_home int,
  _et_away int,
  _pen_home int,
  _pen_away int
)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN _pen_home IS NOT NULL AND _pen_away IS NOT NULL THEN
      CASE
        WHEN _pen_home > _pen_away THEN _home_team_id
        WHEN _pen_away > _pen_home THEN _away_team_id
        ELSE NULL
      END
    WHEN _et_home IS NOT NULL AND _et_away IS NOT NULL THEN
      CASE
        WHEN _et_home > _et_away THEN _home_team_id
        WHEN _et_away > _et_home THEN _away_team_id
        ELSE NULL
      END
    WHEN _home_score IS NOT NULL AND _away_score IS NOT NULL THEN
      CASE
        WHEN _home_score > _away_score THEN _home_team_id
        WHEN _away_score > _home_score THEN _away_team_id
        ELSE NULL
      END
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION private.count_support_team_advances(
  _competition_id uuid,
  _team_id uuid
)
RETURNS int
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::int
  FROM public.matches m
  WHERE m.competition_id = _competition_id
    AND m.status = 'finished'
    AND private.is_knockout_bracket_phase(m.phase)
    AND private.match_winning_team_id(
      m.home_team_id, m.away_team_id,
      m.home_score, m.away_score,
      m.et_home_score, m.et_away_score,
      m.pen_home_score, m.pen_away_score
    ) = _team_id;
$$;

-- -----------------------------------------------------------------------------
-- 5. recalc_special_bets
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recalc_special_bets(_tournament_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ts RECORD;
  v_comp UUID;
  r RECORD;
  v_advances INT;
  v_x INT;
  v_champ BOOLEAN;
  v_pts INT;
BEGIN
  SELECT ts.*, t.competition_id AS competition_id
  INTO ts
  FROM public.tournament_settings ts
  JOIN public.tournaments t ON t.id = ts.tournament_id
  WHERE ts.tournament_id = _tournament_id;

  IF NOT FOUND OR NOT COALESCE(ts.special_bets_enabled, false) THEN
    UPDATE public.special_bets SET points = 0, updated_at = now()
    WHERE tournament_id = _tournament_id;
    PERFORM public.refresh_member_special_bets_points(_tournament_id, tm.user_id)
    FROM public.tournament_members tm
    WHERE tm.tournament_id = _tournament_id;
    RETURN;
  END IF;

  v_comp := ts.competition_id;

  UPDATE public.special_bets sb
  SET points = CASE
    WHEN ts.special_bet_winner_enabled AND ts.official_winner_team_id IS NOT NULL
      AND sb.team_id = ts.official_winner_team_id
    THEN COALESCE(ts.points_winner, 0) ELSE 0 END,
    updated_at = now()
  WHERE sb.tournament_id = _tournament_id AND sb.bet_type = 'winner';

  UPDATE public.special_bets sb
  SET points = CASE
    WHEN ts.special_bet_top_scorer_enabled AND ts.official_top_scorer IS NOT NULL
      AND lower(trim(sb.value)) = lower(trim(ts.official_top_scorer))
    THEN CASE WHEN ts.top_scorer_mode = 'per_goal'
      THEN COALESCE(ts.official_top_scorer_goals, 0) * COALESCE(ts.points_top_scorer_per_goal, 1)
      ELSE COALESCE(ts.points_top_scorer, 0) END
    ELSE 0 END,
    updated_at = now()
  WHERE sb.tournament_id = _tournament_id AND sb.bet_type = 'top_scorer';

  UPDATE public.special_bets sb
  SET points = CASE
    WHEN ts.special_bet_best_defense_enabled AND ts.official_best_defense_team_id IS NOT NULL
      AND sb.team_id = ts.official_best_defense_team_id
    THEN COALESCE(ts.points_best_defense, 0) ELSE 0 END,
    updated_at = now()
  WHERE sb.tournament_id = _tournament_id AND sb.bet_type = 'best_defense';

  v_x := GREATEST(COALESCE(ts.points_support_advance, 0), 0);
  FOR r IN
    SELECT sb.id, sb.team_id, sb.user_id
    FROM public.special_bets sb
    WHERE sb.tournament_id = _tournament_id AND sb.bet_type = 'support_team'
  LOOP
    IF NOT COALESCE(ts.special_bet_support_team_enabled, false) OR r.team_id IS NULL THEN
      v_pts := 0;
    ELSE
      v_advances := private.count_support_team_advances(v_comp, r.team_id);
      v_champ := (
        ts.official_winner_team_id IS NOT NULL AND r.team_id = ts.official_winner_team_id
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
      v_pts := (v_advances * v_x) + (CASE WHEN v_champ THEN v_x ELSE 0 END);
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

REVOKE ALL ON FUNCTION public.recalc_special_bets(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recalc_special_bets(UUID) TO service_role;

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
     OR NEW.points_support_advance IS DISTINCT FROM OLD.points_support_advance THEN
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

CREATE OR REPLACE FUNCTION public.recalc_match_predictions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_knockout boolean := false;
  t RECORD;
BEGIN
  IF NEW.home_score IS NULL OR NEW.away_score IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND
     NEW.home_score IS NOT DISTINCT FROM OLD.home_score AND
     NEW.away_score IS NOT DISTINCT FROM OLD.away_score AND
     NEW.et_home_score IS NOT DISTINCT FROM OLD.et_home_score AND
     NEW.et_away_score IS NOT DISTINCT FROM OLD.et_away_score AND
     NEW.pen_home_score IS NOT DISTINCT FROM OLD.pen_home_score AND
     NEW.pen_away_score IS NOT DISTINCT FROM OLD.pen_away_score AND
     NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  SELECT c.format IN (
    'groups_then_knockout',
    'league_phase_then_knockout',
    'groups_then_finals',
    'knockout_only'
  ) OR COALESCE(NEW.phase, '') ILIKE '%knock%' OR COALESCE(NEW.phase, '') ILIKE '%final%'
  INTO v_knockout
  FROM public.competitions c
  WHERE c.id = NEW.competition_id;

  UPDATE public.predictions p
  SET
    points = CASE
      WHEN p.is_wildcard AND COALESCE(ts.wildcard_enabled, false) AND calc.points > 0
        THEN calc.points * GREATEST(COALESCE(ts.wildcard_multiplier, 1), 1)
      ELSE calc.points
    END,
    exact = calc.exact
  FROM public.tournament_settings ts,
  LATERAL public.calc_prediction_points(
    p.home_pred, p.away_pred, NEW.home_score, NEW.away_score,
    ts.points_outcome, ts.points_exact_bonus,
    p.et_home_pred, p.et_away_pred, p.pen_home_pred, p.pen_away_pred,
    NEW.et_home_score, NEW.et_away_score, NEW.pen_home_score, NEW.pen_away_score,
    COALESCE(v_knockout, false)
  ) AS calc
  WHERE p.match_id = NEW.id
    AND ts.tournament_id = p.tournament_id;

  PERFORM public.refresh_pred_stats_for_match(NEW.id);

  FOR t IN
    SELECT id FROM public.tournaments WHERE competition_id = NEW.competition_id
  LOOP
    PERFORM public.recalc_tournament_streaks(t.id);
    IF NEW.status = 'finished' THEN
      PERFORM public.recalc_special_bets(t.id);
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.recalc_tournament_streaks(UUID) IS
  'Win streak over finished competition matches ordered by kickoff_at, finished_at. Missing prediction breaks streak.';
