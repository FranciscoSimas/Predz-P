-- Phase 1: harden multi-tenant access and prepare provider upserts.

-- Keep policy helper functions outside the exposed public API schema.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.is_tournament_member(_tournament_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tournament_members tm
    WHERE tm.tournament_id = _tournament_id
      AND tm.user_id = (SELECT auth.uid())
  );
$$;

CREATE OR REPLACE FUNCTION private.is_tournament_admin(_tournament_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tournament_members tm
    WHERE tm.tournament_id = _tournament_id
      AND tm.user_id = (SELECT auth.uid())
      AND tm.role IN ('owner', 'admin')
  );
$$;

CREATE OR REPLACE FUNCTION private.is_public_tournament(_tournament_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tournaments t
    WHERE t.id = _tournament_id
      AND t.is_public
  );
$$;

CREATE OR REPLACE FUNCTION private.prediction_context_valid(
  _tournament_id UUID,
  _match_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.is_tournament_member(_tournament_id)
    AND EXISTS (
      SELECT 1
      FROM public.tournaments t
      JOIN public.matches m
        ON m.competition_id = t.competition_id
      WHERE t.id = _tournament_id
        AND m.id = _match_id
    );
$$;

REVOKE ALL ON FUNCTION private.is_tournament_member(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.is_tournament_admin(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.is_public_tournament(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.prediction_context_valid(UUID, UUID) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION private.is_tournament_member(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.is_tournament_admin(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.is_public_tournament(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.prediction_context_valid(UUID, UUID) TO authenticated, service_role;

-- Profiles: clients only need direct access to their own complete profile.
-- Shared names and avatars are exposed through the membership-checked leaderboard.
DROP POLICY IF EXISTS "profiles readable by authenticated" ON public.profiles;
DROP POLICY IF EXISTS "profiles insert own" ON public.profiles;
DROP POLICY IF EXISTS "profiles update own" ON public.profiles;

CREATE POLICY "profiles read own"
  ON public.profiles FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid()));

CREATE POLICY "profiles update own"
  ON public.profiles FOR UPDATE TO authenticated
  USING (id = (SELECT auth.uid()))
  WITH CHECK (id = (SELECT auth.uid()));

REVOKE INSERT ON public.profiles FROM authenticated;

-- Tournaments: prevent clients from changing ownership, competition, join code,
-- or other identity columns after creation.
DROP POLICY IF EXISTS "tournaments visible if public or member" ON public.tournaments;
DROP POLICY IF EXISTS "tournaments insert own" ON public.tournaments;
DROP POLICY IF EXISTS "tournaments update by admin" ON public.tournaments;
DROP POLICY IF EXISTS "tournaments delete by owner" ON public.tournaments;

CREATE POLICY "tournaments visible if public or member"
  ON public.tournaments FOR SELECT TO authenticated
  USING (
    is_public
    OR private.is_tournament_member(id)
    OR owner_id = (SELECT auth.uid())
  );

CREATE POLICY "tournaments insert own"
  ON public.tournaments FOR INSERT TO authenticated
  WITH CHECK (owner_id = (SELECT auth.uid()));

CREATE POLICY "tournaments update safe fields by admin"
  ON public.tournaments FOR UPDATE TO authenticated
  USING (private.is_tournament_admin(id))
  WITH CHECK (private.is_tournament_admin(id));

CREATE POLICY "tournaments delete by owner"
  ON public.tournaments FOR DELETE TO authenticated
  USING (owner_id = (SELECT auth.uid()));

REVOKE UPDATE ON public.tournaments FROM authenticated;
GRANT UPDATE (name, description, is_public, cover_color)
  ON public.tournaments TO authenticated;

-- Membership: direct self-join is only valid for public tournaments and can
-- only create a member role. Private joins continue through the code RPC.
DROP POLICY IF EXISTS "tm select if in same tournament" ON public.tournament_members;
DROP POLICY IF EXISTS "tm join self" ON public.tournament_members;
DROP POLICY IF EXISTS "tm admin manage" ON public.tournament_members;
DROP POLICY IF EXISTS "tm leave or admin remove" ON public.tournament_members;

CREATE POLICY "tm select if in same tournament"
  ON public.tournament_members FOR SELECT TO authenticated
  USING (private.is_tournament_member(tournament_id));

CREATE POLICY "tm join public as member"
  ON public.tournament_members FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND role = 'member'
    AND private.is_public_tournament(tournament_id)
  );

CREATE POLICY "tm admin update roles"
  ON public.tournament_members FOR UPDATE TO authenticated
  USING (private.is_tournament_admin(tournament_id))
  WITH CHECK (
    private.is_tournament_admin(tournament_id)
    AND role IN ('admin', 'member')
  );

CREATE POLICY "tm leave or admin remove"
  ON public.tournament_members FOR DELETE TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR private.is_tournament_admin(tournament_id)
  );

REVOKE UPDATE ON public.tournament_members FROM authenticated;
GRANT UPDATE (role) ON public.tournament_members TO authenticated;

-- Settings are created by the tournament trigger. Clients never insert them.
DROP POLICY IF EXISTS "ts read if member" ON public.tournament_settings;
DROP POLICY IF EXISTS "ts write if admin" ON public.tournament_settings;
DROP POLICY IF EXISTS "ts insert if admin" ON public.tournament_settings;

CREATE POLICY "ts read if member"
  ON public.tournament_settings FOR SELECT TO authenticated
  USING (private.is_tournament_member(tournament_id));

CREATE POLICY "ts write if admin"
  ON public.tournament_settings FOR UPDATE TO authenticated
  USING (private.is_tournament_admin(tournament_id))
  WITH CHECK (private.is_tournament_admin(tournament_id));

REVOKE INSERT ON public.tournament_settings FROM authenticated;

-- Predictions: users may edit prediction inputs, but never computed points or
-- exact flags. The match must belong to the tournament competition.
DROP POLICY IF EXISTS "predictions own or admin read" ON public.predictions;
DROP POLICY IF EXISTS "predictions insert own if member" ON public.predictions;
DROP POLICY IF EXISTS "predictions update own" ON public.predictions;
DROP POLICY IF EXISTS "predictions delete own" ON public.predictions;

CREATE POLICY "predictions own or admin read"
  ON public.predictions FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR private.is_tournament_admin(tournament_id)
  );

CREATE POLICY "predictions insert own valid match"
  ON public.predictions FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND private.prediction_context_valid(tournament_id, match_id)
  );

CREATE POLICY "predictions update own valid match"
  ON public.predictions FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND private.prediction_context_valid(tournament_id, match_id)
  );

CREATE POLICY "predictions delete own"
  ON public.predictions FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

REVOKE INSERT, UPDATE ON public.predictions FROM authenticated;
GRANT INSERT (
  tournament_id,
  user_id,
  match_id,
  home_pred,
  away_pred,
  et_home_pred,
  et_away_pred,
  pen_home_pred,
  pen_away_pred,
  is_wildcard
) ON public.predictions TO authenticated;
GRANT UPDATE (
  tournament_id,
  user_id,
  match_id,
  home_pred,
  away_pred,
  et_home_pred,
  et_away_pred,
  pen_home_pred,
  pen_away_pred,
  is_wildcard
) ON public.predictions TO authenticated;

ALTER TABLE public.predictions
  ADD CONSTRAINT predictions_home_pred_range
    CHECK (home_pred IS NULL OR home_pred BETWEEN 0 AND 30),
  ADD CONSTRAINT predictions_away_pred_range
    CHECK (away_pred IS NULL OR away_pred BETWEEN 0 AND 30),
  ADD CONSTRAINT predictions_et_home_pred_range
    CHECK (et_home_pred IS NULL OR et_home_pred BETWEEN 0 AND 30),
  ADD CONSTRAINT predictions_et_away_pred_range
    CHECK (et_away_pred IS NULL OR et_away_pred BETWEEN 0 AND 30),
  ADD CONSTRAINT predictions_pen_home_pred_range
    CHECK (pen_home_pred IS NULL OR pen_home_pred BETWEEN 0 AND 30),
  ADD CONSTRAINT predictions_pen_away_pred_range
    CHECK (pen_away_pred IS NULL OR pen_away_pred BETWEEN 0 AND 30);

-- Replace the unrestricted definer view with an invoker view backed by a
-- private function that only returns tournaments shared by the current user.
CREATE OR REPLACE FUNCTION private.current_user_leaderboard()
RETURNS TABLE (
  tournament_id UUID,
  user_id UUID,
  display_name TEXT,
  avatar_url TEXT,
  total_points INT,
  correct_count INT,
  exact_count INT,
  predictions_made INT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    tm.tournament_id,
    tm.user_id,
    pr.display_name,
    pr.avatar_url,
    COALESCE(SUM(p.points), 0)::INT AS total_points,
    COUNT(p.id) FILTER (WHERE p.points > 0)::INT AS correct_count,
    COUNT(p.id) FILTER (WHERE p.exact)::INT AS exact_count,
    COUNT(p.id) FILTER (WHERE p.home_pred IS NOT NULL)::INT AS predictions_made
  FROM public.tournament_members tm
  LEFT JOIN public.profiles pr
    ON pr.id = tm.user_id
  LEFT JOIN public.predictions p
    ON p.tournament_id = tm.tournament_id
   AND p.user_id = tm.user_id
  WHERE private.is_tournament_member(tm.tournament_id)
  GROUP BY
    tm.tournament_id,
    tm.user_id,
    pr.display_name,
    pr.avatar_url;
$$;

REVOKE ALL ON FUNCTION private.current_user_leaderboard() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.current_user_leaderboard()
  TO authenticated, service_role;

CREATE OR REPLACE VIEW public.tournament_leaderboard
WITH (security_invoker = true)
AS
SELECT *
FROM private.current_user_leaderboard();

GRANT SELECT ON public.tournament_leaderboard TO authenticated;

-- Public helper functions accepted arbitrary user IDs and were directly
-- exposed through PostgREST. Policies now use the private self-scoped helpers.
DROP FUNCTION IF EXISTS public.is_tournament_member(UUID, UUID);
DROP FUNCTION IF EXISTS public.is_tournament_admin(UUID, UUID);

-- Trigger-only functions must not be callable as public RPC endpoints.
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.add_owner_as_member() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lock_predictions_after_kickoff() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recalc_match_predictions() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.calc_prediction_points(
  INT, INT, INT, INT, INT, INT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;
GRANT EXECUTE ON FUNCTION public.add_owner_as_member() TO service_role;
GRANT EXECUTE ON FUNCTION public.lock_predictions_after_kickoff() TO service_role;
GRANT EXECUTE ON FUNCTION public.recalc_match_predictions() TO service_role;
GRANT EXECUTE ON FUNCTION public.set_updated_at() TO service_role;
GRANT EXECUTE ON FUNCTION public.calc_prediction_points(
  INT, INT, INT, INT, INT, INT
) TO service_role;

ALTER FUNCTION public.calc_prediction_points(
  INT, INT, INT, INT, INT, INT
) SET search_path = public;

-- The join-by-code RPC is intentionally exposed only to signed-in users.
REVOKE ALL ON FUNCTION public.join_tournament_by_code(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_tournament_by_code(TEXT)
  TO authenticated, service_role;

-- Provider-aware upsert foundation.
ALTER TABLE public.matches
  ADD CONSTRAINT matches_external_id_key UNIQUE (external_id);

ALTER TABLE public.competition_teams
  ADD CONSTRAINT competition_teams_competition_external_id_key
  UNIQUE (competition_id, external_id);

CREATE INDEX idx_matches_home_team
  ON public.matches(home_team_id);
CREATE INDEX idx_matches_away_team
  ON public.matches(away_team_id);
CREATE INDEX idx_tournament_settings_official_winner
  ON public.tournament_settings(official_winner_team_id);

UPDATE public.competitions
SET
  external_provider = 'football-data',
  external_id = 'PPL'
WHERE slug = 'liga-portugal-25-26';
