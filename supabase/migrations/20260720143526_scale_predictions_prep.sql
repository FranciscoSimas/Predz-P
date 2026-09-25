-- =============================================================================
-- Scale prep for predictions growth (60k–1M+ rows)
-- - Hot-path indexes for matches + predictions reads/scoring
-- - Cache special_bets points on tournament_members (leaderboard O(members))
-- - Fix remaining RLS auth.uid() initplan warnings
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Indexes
-- -----------------------------------------------------------------------------

-- List / navigate fixtures by competition + status (predictions, matches tabs)
CREATE INDEX IF NOT EXISTS idx_matches_comp_status_kickoff
  ON public.matches (competition_id, status, kickoff_at);

-- Sync / "upcoming" scans (majority of rows stay scheduled early season)
CREATE INDEX IF NOT EXISTS idx_matches_scheduled_comp_kickoff
  ON public.matches (competition_id, kickoff_at)
  WHERE status = 'scheduled';

-- Scoring trigger uses existing idx_predictions_match (match_id)

-- Predictions page: all picks for (tournament, user) — index-only friendly
CREATE INDEX IF NOT EXISTS idx_predictions_tournament_user_covering
  ON public.predictions (tournament_id, user_id)
  INCLUDE (match_id, home_pred, away_pred, points, exact, is_wildcard);

-- Special bets leaderboard cache refresh
CREATE INDEX IF NOT EXISTS idx_special_bets_tournament_user_points
  ON public.special_bets (tournament_id, user_id)
  INCLUDE (points);

-- -----------------------------------------------------------------------------
-- 2. Cache special_bets points on members (avoid LATERAL SUM per leaderboard row)
-- -----------------------------------------------------------------------------
ALTER TABLE public.tournament_members
  ADD COLUMN IF NOT EXISTS special_bets_points INT NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.refresh_member_special_bets_points(
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
    special_bets_points = COALESCE((
      SELECT SUM(s.points)::INT
      FROM public.special_bets s
      WHERE s.tournament_id = _tournament_id AND s.user_id = _user_id
    ), 0),
    stats_updated_at = now()
  WHERE tm.tournament_id = _tournament_id AND tm.user_id = _user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_member_special_bets_points(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_member_special_bets_points(UUID, UUID)
  TO service_role;

CREATE OR REPLACE FUNCTION public.trg_refresh_member_special_bets_points()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.refresh_member_special_bets_points(OLD.tournament_id, OLD.user_id);
    RETURN OLD;
  END IF;
  PERFORM public.refresh_member_special_bets_points(NEW.tournament_id, NEW.user_id);
  IF TG_OP = 'UPDATE'
     AND (OLD.tournament_id, OLD.user_id)
       IS DISTINCT FROM (NEW.tournament_id, NEW.user_id) THEN
    PERFORM public.refresh_member_special_bets_points(OLD.tournament_id, OLD.user_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_special_bets_refresh_member_points ON public.special_bets;
CREATE TRIGGER trg_special_bets_refresh_member_points
  AFTER INSERT OR DELETE OR UPDATE OF points, tournament_id, user_id
  ON public.special_bets
  FOR EACH ROW EXECUTE FUNCTION public.trg_refresh_member_special_bets_points();

REVOKE ALL ON FUNCTION public.trg_refresh_member_special_bets_points()
  FROM PUBLIC, anon, authenticated;

-- Backfill
UPDATE public.tournament_members tm
SET special_bets_points = COALESCE(agg.pts, 0),
    stats_updated_at = now()
FROM (
  SELECT tournament_id, user_id, COALESCE(SUM(points), 0)::INT AS pts
  FROM public.special_bets
  GROUP BY tournament_id, user_id
) agg
WHERE tm.tournament_id = agg.tournament_id
  AND tm.user_id = agg.user_id;

-- Leaderboard: pure member-row math (no SUM over predictions / special_bets)
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
      + COALESCE(tm.special_bets_points, 0)
      + COALESCE(st.bonus_points, 0)
    )::INT,
    COALESCE(tm.correct_count, 0)::INT,
    COALESCE(tm.exact_count, 0)::INT,
    COALESCE(tm.predictions_made, 0)::INT,
    COALESCE(tm.special_bets_points, 0)::INT,
    COALESCE(st.bonus_points, 0)::INT,
    COALESCE(st.current_streak, 0)::INT,
    COALESCE(st.best_streak, 0)::INT,
    COALESCE(tm.wildcards_used, 0)::INT
  FROM public.tournament_members tm
  LEFT JOIN public.profiles pr ON pr.id = tm.user_id
  LEFT JOIN public.tournament_member_streaks st
    ON st.tournament_id = tm.tournament_id AND st.user_id = tm.user_id
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
      + COALESCE(tm.special_bets_points, 0)
      + COALESCE(st.bonus_points, 0)
    )::INT,
    COALESCE(tm.correct_count, 0)::INT,
    COALESCE(tm.exact_count, 0)::INT,
    COALESCE(tm.predictions_made, 0)::INT,
    COALESCE(tm.special_bets_points, 0)::INT,
    COALESCE(st.bonus_points, 0)::INT,
    COALESCE(st.current_streak, 0)::INT,
    COALESCE(st.best_streak, 0)::INT,
    COALESCE(tm.wildcards_used, 0)::INT
  FROM public.tournament_members tm
  LEFT JOIN public.profiles pr ON pr.id = tm.user_id
  LEFT JOIN public.tournament_member_streaks st
    ON st.tournament_id = tm.tournament_id AND st.user_id = tm.user_id
  WHERE tm.tournament_id = _tournament_id
    AND private.is_tournament_member(_tournament_id);
$$;

DROP VIEW IF EXISTS public.tournament_leaderboard;
CREATE VIEW public.tournament_leaderboard
WITH (security_invoker = true)
AS SELECT * FROM private.current_user_leaderboard();

GRANT SELECT ON public.tournament_leaderboard TO authenticated;

-- -----------------------------------------------------------------------------
-- 3. RLS: evaluate auth.uid() once per statement
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "special_bets insert own" ON public.special_bets;
CREATE POLICY "special_bets insert own"
  ON public.special_bets FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND private.is_tournament_member(tournament_id)
    AND EXISTS (
      SELECT 1 FROM public.tournament_settings ts
      WHERE ts.tournament_id = special_bets.tournament_id
        AND ts.special_bets_enabled = true
        AND (ts.special_bets_cutoff_at IS NULL OR ts.special_bets_cutoff_at > now())
    )
  );

DROP POLICY IF EXISTS "special_bets update own" ON public.special_bets;
CREATE POLICY "special_bets update own"
  ON public.special_bets FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.tournament_settings ts
      WHERE ts.tournament_id = special_bets.tournament_id
        AND (ts.special_bets_cutoff_at IS NULL OR ts.special_bets_cutoff_at > now())
    )
  );

DROP POLICY IF EXISTS "special_bets delete own" ON public.special_bets;
CREATE POLICY "special_bets delete own"
  ON public.special_bets FOR DELETE TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.tournament_settings ts
      WHERE ts.tournament_id = special_bets.tournament_id
        AND (ts.special_bets_cutoff_at IS NULL OR ts.special_bets_cutoff_at > now())
    )
  );

DROP POLICY IF EXISTS "tournaments insert own" ON public.tournaments;
CREATE POLICY "tournaments insert own"
  ON public.tournaments FOR INSERT TO authenticated
  WITH CHECK (
    owner_id = (SELECT auth.uid())
    AND ((NOT is_official) OR private.is_platform_admin())
  );

DROP POLICY IF EXISTS "platform_admins self read" ON public.platform_admins;
CREATE POLICY "platform_admins self read"
  ON public.platform_admins FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

ANALYZE public.matches;
ANALYZE public.predictions;
ANALYZE public.tournament_members;
ANALYZE public.special_bets;
