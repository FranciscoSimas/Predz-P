-- =============================================================================
-- Harden scoring (knockout + wildcard + streaks), security, and performance
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Indexes for common filters / joins
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_tm_tournament
  ON public.tournament_members(tournament_id);

CREATE INDEX IF NOT EXISTS idx_tm_tournament_role
  ON public.tournament_members(tournament_id, role);

CREATE INDEX IF NOT EXISTS idx_predictions_tournament_user
  ON public.predictions(tournament_id, user_id);

CREATE INDEX IF NOT EXISTS idx_predictions_match_tournament
  ON public.predictions(match_id, tournament_id);

CREATE INDEX IF NOT EXISTS idx_special_bets_tournament_user
  ON public.special_bets(tournament_id, user_id);

CREATE INDEX IF NOT EXISTS idx_tournaments_public
  ON public.tournaments(is_public)
  WHERE is_public = true;

CREATE INDEX IF NOT EXISTS idx_tournaments_join_code
  ON public.tournaments(join_code);

CREATE INDEX IF NOT EXISTS idx_matches_competition_kickoff
  ON public.matches(competition_id, kickoff_at);

-- -----------------------------------------------------------------------------
-- 2. Denormalized member prediction stats (avoids SUM on every leaderboard read)
-- -----------------------------------------------------------------------------
ALTER TABLE public.tournament_members
  ADD COLUMN IF NOT EXISTS pred_points INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS correct_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS exact_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS predictions_made INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wildcards_used INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stats_updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Clients must not write cached stats
REVOKE UPDATE ON public.tournament_members FROM authenticated;
GRANT UPDATE (role) ON public.tournament_members TO authenticated;

CREATE OR REPLACE FUNCTION public.refresh_member_pred_stats(
  _tournament_id UUID,
  _user_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.tournament_members tm
  SET
    pred_points = COALESCE((
      SELECT SUM(p.points)::INT FROM public.predictions p
      WHERE p.tournament_id = _tournament_id AND p.user_id = _user_id
    ), 0),
    correct_count = COALESCE((
      SELECT COUNT(*)::INT FROM public.predictions p
      WHERE p.tournament_id = _tournament_id AND p.user_id = _user_id AND p.points > 0
    ), 0),
    exact_count = COALESCE((
      SELECT COUNT(*)::INT FROM public.predictions p
      WHERE p.tournament_id = _tournament_id AND p.user_id = _user_id AND p.exact
    ), 0),
    predictions_made = COALESCE((
      SELECT COUNT(*)::INT FROM public.predictions p
      WHERE p.tournament_id = _tournament_id AND p.user_id = _user_id
        AND p.home_pred IS NOT NULL
    ), 0),
    wildcards_used = COALESCE((
      SELECT COUNT(*)::INT FROM public.predictions p
      WHERE p.tournament_id = _tournament_id AND p.user_id = _user_id AND p.is_wildcard
    ), 0),
    stats_updated_at = now()
  WHERE tm.tournament_id = _tournament_id AND tm.user_id = _user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_member_pred_stats(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_member_pred_stats(UUID, UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.trg_refresh_member_pred_stats()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.refresh_member_pred_stats(OLD.tournament_id, OLD.user_id);
    RETURN OLD;
  END IF;
  PERFORM public.refresh_member_pred_stats(NEW.tournament_id, NEW.user_id);
  IF TG_OP = 'UPDATE'
     AND (OLD.tournament_id, OLD.user_id) IS DISTINCT FROM (NEW.tournament_id, NEW.user_id) THEN
    PERFORM public.refresh_member_pred_stats(OLD.tournament_id, OLD.user_id);
  END IF;
  RETURN NEW;
END;
$$;

-- Only when the user edits picks — NOT when points/exact are recalculated
DROP TRIGGER IF EXISTS trg_predictions_refresh_member_stats ON public.predictions;
CREATE TRIGGER trg_predictions_refresh_member_stats
  AFTER INSERT OR DELETE OR UPDATE OF
    home_pred, away_pred, et_home_pred, et_away_pred,
    pen_home_pred, pen_away_pred, is_wildcard, tournament_id, user_id, match_id
  ON public.predictions
  FOR EACH ROW EXECUTE FUNCTION public.trg_refresh_member_pred_stats();

REVOKE ALL ON FUNCTION public.trg_refresh_member_pred_stats() FROM PUBLIC, anon, authenticated;

-- Bulk refresh after match scoring (avoids N per-row refreshes)
CREATE OR REPLACE FUNCTION public.refresh_pred_stats_for_match(_match_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.tournament_members tm
  SET
    pred_points = COALESCE(agg.pred_points, 0),
    correct_count = COALESCE(agg.correct_count, 0),
    exact_count = COALESCE(agg.exact_count, 0),
    predictions_made = COALESCE(agg.predictions_made, 0),
    wildcards_used = COALESCE(agg.wildcards_used, 0),
    stats_updated_at = now()
  FROM (
    SELECT
      p.tournament_id,
      p.user_id,
      COALESCE(SUM(p.points), 0)::INT AS pred_points,
      COUNT(*) FILTER (WHERE p.points > 0)::INT AS correct_count,
      COUNT(*) FILTER (WHERE p.exact)::INT AS exact_count,
      COUNT(*) FILTER (WHERE p.home_pred IS NOT NULL)::INT AS predictions_made,
      COUNT(*) FILTER (WHERE p.is_wildcard)::INT AS wildcards_used
    FROM public.predictions p
    WHERE (p.tournament_id, p.user_id) IN (
      SELECT DISTINCT tournament_id, user_id
      FROM public.predictions
      WHERE match_id = _match_id
    )
    GROUP BY p.tournament_id, p.user_id
  ) agg
  WHERE tm.tournament_id = agg.tournament_id
    AND tm.user_id = agg.user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_pred_stats_for_match(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_pred_stats_for_match(UUID) TO service_role;

-- Backfill existing members
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT tournament_id, user_id FROM public.tournament_members LOOP
    PERFORM public.refresh_member_pred_stats(r.tournament_id, r.user_id);
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 3. Fix recalc_match_predictions: knockout + wildcard + streaks (set-based)
-- -----------------------------------------------------------------------------
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

  -- Single set-based update (no per-row loop)
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

  -- Refresh cached stats for everyone who predicted this match
  PERFORM public.refresh_pred_stats_for_match(NEW.id);

  -- Streaks for every tournament sharing this competition
  FOR t IN
    SELECT id FROM public.tournaments WHERE competition_id = NEW.competition_id
  LOOP
    PERFORM public.recalc_tournament_streaks(t.id);
  END LOOP;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.recalc_match_predictions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recalc_match_predictions() TO service_role;

DROP TRIGGER IF EXISTS trg_recalc_match_predictions ON public.matches;
CREATE TRIGGER trg_recalc_match_predictions
  AFTER INSERT OR UPDATE OF home_score, away_score, et_home_score, et_away_score,
    pen_home_score, pen_away_score, status, phase
  ON public.matches
  FOR EACH ROW EXECUTE FUNCTION public.recalc_match_predictions();

-- -----------------------------------------------------------------------------
-- 4. Leaderboard: use cached pred stats + filter by membership
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.current_user_leaderboard()
RETURNS TABLE(
  tournament_id uuid, user_id uuid, display_name text, avatar_url text,
  total_points integer, correct_count integer, exact_count integer, predictions_made integer,
  special_bets_points integer, streak_bonus_points integer,
  current_streak integer, best_streak integer, wildcards_used integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT
    tm.tournament_id,
    tm.user_id,
    pr.display_name,
    pr.avatar_url,
    (
      COALESCE(tm.pred_points, 0)
      + COALESCE(sb.pts, 0)
      + COALESCE(st.bonus_points, 0)
    )::INT,
    COALESCE(tm.correct_count, 0)::INT,
    COALESCE(tm.exact_count, 0)::INT,
    COALESCE(tm.predictions_made, 0)::INT,
    COALESCE(sb.pts, 0)::INT,
    COALESCE(st.bonus_points, 0)::INT,
    COALESCE(st.current_streak, 0)::INT,
    COALESCE(st.best_streak, 0)::INT,
    COALESCE(tm.wildcards_used, 0)::INT
  FROM public.tournament_members tm
  LEFT JOIN public.profiles pr ON pr.id = tm.user_id
  LEFT JOIN public.tournament_member_streaks st
    ON st.tournament_id = tm.tournament_id AND st.user_id = tm.user_id
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(s.points), 0)::INT AS pts
    FROM public.special_bets s
    WHERE s.tournament_id = tm.tournament_id AND s.user_id = tm.user_id
  ) sb ON true
  WHERE private.is_tournament_member(tm.tournament_id);
$$;

CREATE OR REPLACE FUNCTION public.get_tournament_leaderboard(_tournament_id UUID)
RETURNS TABLE(
  tournament_id uuid, user_id uuid, display_name text, avatar_url text,
  total_points integer, correct_count integer, exact_count integer, predictions_made integer,
  special_bets_points integer, streak_bonus_points integer,
  current_streak integer, best_streak integer, wildcards_used integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT
    tm.tournament_id,
    tm.user_id,
    pr.display_name,
    pr.avatar_url,
    (
      COALESCE(tm.pred_points, 0)
      + COALESCE(sb.pts, 0)
      + COALESCE(st.bonus_points, 0)
    )::INT,
    COALESCE(tm.correct_count, 0)::INT,
    COALESCE(tm.exact_count, 0)::INT,
    COALESCE(tm.predictions_made, 0)::INT,
    COALESCE(sb.pts, 0)::INT,
    COALESCE(st.bonus_points, 0)::INT,
    COALESCE(st.current_streak, 0)::INT,
    COALESCE(st.best_streak, 0)::INT,
    COALESCE(tm.wildcards_used, 0)::INT
  FROM public.tournament_members tm
  LEFT JOIN public.profiles pr ON pr.id = tm.user_id
  LEFT JOIN public.tournament_member_streaks st
    ON st.tournament_id = tm.tournament_id AND st.user_id = tm.user_id
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(s.points), 0)::INT AS pts
    FROM public.special_bets s
    WHERE s.tournament_id = tm.tournament_id AND s.user_id = tm.user_id
  ) sb ON true
  WHERE tm.tournament_id = _tournament_id
    AND private.is_tournament_member(_tournament_id);
$$;

REVOKE ALL ON FUNCTION public.get_tournament_leaderboard(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_tournament_leaderboard(UUID) TO authenticated, service_role;

DROP VIEW IF EXISTS public.tournament_leaderboard;
CREATE VIEW public.tournament_leaderboard
WITH (security_invoker = true)
AS SELECT * FROM private.current_user_leaderboard();

GRANT SELECT ON public.tournament_leaderboard TO authenticated;

-- -----------------------------------------------------------------------------
-- 5. special_bets: hide picks until cutoff; lock points column
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "special_bets select member" ON public.special_bets;
CREATE POLICY "special_bets select own admin or after cutoff"
  ON public.special_bets FOR SELECT TO authenticated
  USING (
    private.is_tournament_member(tournament_id)
    AND (
      user_id = (SELECT auth.uid())
      OR private.is_tournament_admin(tournament_id)
      OR EXISTS (
        SELECT 1 FROM public.tournament_settings ts
        WHERE ts.tournament_id = special_bets.tournament_id
          AND ts.special_bets_cutoff_at IS NOT NULL
          AND ts.special_bets_cutoff_at <= now()
      )
    )
  );

REVOKE INSERT, UPDATE ON public.special_bets FROM authenticated;
GRANT INSERT (
  tournament_id,
  user_id,
  bet_type,
  value,
  team_id
) ON public.special_bets TO authenticated;
GRANT UPDATE (
  bet_type,
  value,
  team_id
) ON public.special_bets TO authenticated;
-- points / created_at / updated_at remain server-only (trigger sets updated_at)

-- -----------------------------------------------------------------------------
-- 6. Rate-limit join_tournament_by_code (anti brute-force)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS private.join_code_attempts (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  success BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_join_code_attempts_user_time
  ON private.join_code_attempts(user_id, attempted_at DESC);

CREATE OR REPLACE FUNCTION public.join_tournament_by_code(_code TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tid UUID;
  v_uid UUID := auth.uid();
  v_recent INT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Autenticação necessária.';
  END IF;

  SELECT COUNT(*)::INT INTO v_recent
  FROM private.join_code_attempts
  WHERE user_id = v_uid
    AND attempted_at > now() - interval '15 minutes';

  IF v_recent >= 20 THEN
    RAISE EXCEPTION 'Demasiadas tentativas. Espera alguns minutos e tenta de novo.';
  END IF;

  SELECT id INTO v_tid
  FROM public.tournaments
  WHERE join_code = upper(trim(_code));

  IF v_tid IS NULL THEN
    INSERT INTO private.join_code_attempts(user_id, success) VALUES (v_uid, false);
    RAISE EXCEPTION 'Torneio não encontrado.';
  END IF;

  INSERT INTO public.tournament_members (tournament_id, user_id, role)
  VALUES (v_tid, v_uid, 'member')
  ON CONFLICT DO NOTHING;

  INSERT INTO private.join_code_attempts(user_id, success) VALUES (v_uid, true);

  -- Cleanup old rows opportunistically (keep last ~7 days)
  DELETE FROM private.join_code_attempts
  WHERE attempted_at < now() - interval '7 days';

  RETURN v_tid;
END;
$$;

REVOKE ALL ON FUNCTION public.join_tournament_by_code(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_tournament_by_code(TEXT) TO authenticated, service_role;
