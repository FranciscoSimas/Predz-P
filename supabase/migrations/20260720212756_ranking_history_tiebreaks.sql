-- Ranking enrichment, post-kickoff history RPCs, unique display names, NUMERIC 1.5x multipliers/points.
-- Also restores recalc_match_predictions to join user_match_picks (broken by scoring_finished_at_and_streak).

-- =============================================================================
-- 1. NUMERIC columns (1.5x multipliers + decimal points)
-- =============================================================================
ALTER TABLE public.tournament_settings
  ALTER COLUMN wildcard_multiplier TYPE NUMERIC(4,1) USING wildcard_multiplier::NUMERIC(4,1),
  ALTER COLUMN win_streak_bonus TYPE NUMERIC(4,1) USING win_streak_bonus::NUMERIC(4,1);

ALTER TABLE public.tournament_settings
  DROP CONSTRAINT IF EXISTS tournament_settings_wildcard_multiplier_check,
  DROP CONSTRAINT IF EXISTS tournament_settings_win_streak_bonus_check;

ALTER TABLE public.tournament_settings
  ADD CONSTRAINT tournament_settings_wildcard_multiplier_check
    CHECK (wildcard_multiplier >= 1 AND wildcard_multiplier <= 10),
  ADD CONSTRAINT tournament_settings_win_streak_bonus_check
    CHECK (win_streak_bonus >= 0 AND win_streak_bonus <= 100);

-- prediction_entries view depends on predictions.points
DROP VIEW IF EXISTS public.prediction_entries;

-- Triggers list UPDATE OF points; must drop before ALTER TYPE
DROP TRIGGER IF EXISTS trg_predictions_refresh_member_stats ON public.predictions;
DROP TRIGGER IF EXISTS trg_special_bets_refresh_member_points ON public.special_bets;

ALTER TABLE public.predictions
  ALTER COLUMN points TYPE NUMERIC(10,1) USING points::NUMERIC(10,1);

ALTER TABLE public.special_bets
  ALTER COLUMN points TYPE NUMERIC(10,1) USING points::NUMERIC(10,1);

CREATE TRIGGER trg_predictions_refresh_member_stats
  AFTER INSERT OR DELETE OR UPDATE OF
    is_wildcard, points, exact, tournament_id, user_id, match_id, pick_id
  ON public.predictions
  FOR EACH ROW EXECUTE FUNCTION public.trg_refresh_member_pred_stats();

CREATE TRIGGER trg_special_bets_refresh_member_points
  AFTER INSERT OR DELETE OR UPDATE OF points, tournament_id, user_id
  ON public.special_bets
  FOR EACH ROW EXECUTE FUNCTION public.trg_refresh_member_special_bets_points();

ALTER TABLE public.tournament_members
  ALTER COLUMN pred_points TYPE NUMERIC(10,1) USING pred_points::NUMERIC(10,1),
  ALTER COLUMN special_bets_points TYPE NUMERIC(10,1) USING special_bets_points::NUMERIC(10,1);

ALTER TABLE public.tournament_member_streaks
  ALTER COLUMN bonus_points TYPE NUMERIC(10,1) USING bonus_points::NUMERIC(10,1);

CREATE OR REPLACE VIEW public.prediction_entries
WITH (security_invoker = true)
AS
SELECT
  p.id,
  p.tournament_id,
  p.user_id,
  p.match_id,
  p.pick_id,
  p.is_wildcard,
  p.points,
  p.exact,
  p.created_at,
  p.updated_at,
  pk.home_pred,
  pk.away_pred,
  pk.et_home_pred,
  pk.et_away_pred,
  pk.pen_home_pred,
  pk.pen_away_pred
FROM public.predictions p
JOIN public.user_match_picks pk ON pk.id = p.pick_id;

GRANT SELECT ON public.prediction_entries TO authenticated;

-- =============================================================================
-- 2. Unique display names (case-insensitive trim)
-- =============================================================================
DO $$
DECLARE
  r RECORD;
  base TEXT;
  candidate TEXT;
  n INT;
BEGIN
  FOR r IN
    SELECT id, display_name
    FROM public.profiles
    WHERE display_name IS NOT NULL AND trim(display_name) <> ''
    ORDER BY created_at ASC NULLS LAST, id ASC
  LOOP
    base := trim(r.display_name);
    candidate := base;
    n := 1;
    WHILE EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id <> r.id
        AND lower(trim(p.display_name)) = lower(candidate)
    ) LOOP
      n := n + 1;
      candidate := base || '_' || n::text;
    END LOOP;
    IF candidate IS DISTINCT FROM r.display_name THEN
      UPDATE public.profiles SET display_name = candidate WHERE id = r.id;
    END IF;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_display_name_ci
  ON public.profiles (lower(trim(display_name)))
  WHERE display_name IS NOT NULL AND trim(display_name) <> '';

CREATE OR REPLACE FUNCTION public.is_display_name_available(
  _name text,
  _user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN _name IS NULL OR trim(_name) = '' THEN false
    ELSE NOT EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE lower(trim(p.display_name)) = lower(trim(_name))
        AND p.id IS DISTINCT FROM _user_id
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.is_display_name_available(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_display_name_available(text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  base TEXT;
  candidate TEXT;
  n INT := 1;
BEGIN
  base := trim(COALESCE(
    NEW.raw_user_meta_data->>'display_name',
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'name',
    split_part(NEW.email, '@', 1)
  ));
  IF base IS NULL OR base = '' THEN
    base := 'user';
  END IF;
  candidate := base;
  WHILE EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE lower(trim(p.display_name)) = lower(candidate)
  ) LOOP
    n := n + 1;
    candidate := base || '_' || n::text;
  END LOOP;

  INSERT INTO public.profiles (id, display_name, email, avatar_url)
  VALUES (
    NEW.id,
    candidate,
    NEW.email,
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- =============================================================================
-- 3. Scoring helpers: numeric sums + join picks
-- =============================================================================
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
  UPDATE public.tournament_members tm SET
    pred_points = COALESCE((
      SELECT SUM(p.points)::NUMERIC(10,1)
      FROM public.predictions p
      WHERE p.tournament_id = _tournament_id AND p.user_id = _user_id
    ), 0),
    correct_count = COALESCE((
      SELECT COUNT(*)::INT
      FROM public.predictions p
      WHERE p.tournament_id = _tournament_id AND p.user_id = _user_id AND p.points > 0
    ), 0),
    exact_count = COALESCE((
      SELECT COUNT(*)::INT
      FROM public.predictions p
      WHERE p.tournament_id = _tournament_id AND p.user_id = _user_id AND p.exact
    ), 0),
    predictions_made = COALESCE((
      SELECT COUNT(*)::INT
      FROM public.predictions p
      WHERE p.tournament_id = _tournament_id AND p.user_id = _user_id
    ), 0),
    wildcards_used = COALESCE((
      SELECT COUNT(*)::INT
      FROM public.predictions p
      WHERE p.tournament_id = _tournament_id AND p.user_id = _user_id AND p.is_wildcard
    ), 0),
    stats_updated_at = now()
  WHERE tm.tournament_id = _tournament_id AND tm.user_id = _user_id;
END;
$$;

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
      SELECT SUM(s.points)::NUMERIC(10,1)
      FROM public.special_bets s
      WHERE s.tournament_id = _tournament_id AND s.user_id = _user_id
    ), 0),
    stats_updated_at = now()
  WHERE tm.tournament_id = _tournament_id AND tm.user_id = _user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_pred_stats_for_match(_match_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.tournament_members tm SET
    pred_points = COALESCE(agg.pred_points, 0),
    correct_count = COALESCE(agg.correct_count, 0),
    exact_count = COALESCE(agg.exact_count, 0),
    predictions_made = COALESCE(agg.predictions_made, 0),
    wildcards_used = COALESCE(agg.wildcards_used, 0),
    stats_updated_at = now()
  FROM (
    SELECT p.tournament_id, p.user_id,
      COALESCE(SUM(p.points), 0)::NUMERIC(10,1) AS pred_points,
      COUNT(*) FILTER (WHERE p.points > 0)::INT AS correct_count,
      COUNT(*) FILTER (WHERE p.exact)::INT AS exact_count,
      COUNT(*)::INT AS predictions_made,
      COUNT(*) FILTER (WHERE p.is_wildcard)::INT AS wildcards_used
    FROM public.predictions p
    WHERE (p.tournament_id, p.user_id) IN (
      SELECT DISTINCT tournament_id, user_id FROM public.predictions WHERE match_id = _match_id
    )
    GROUP BY p.tournament_id, p.user_id
  ) agg
  WHERE tm.tournament_id = agg.tournament_id AND tm.user_id = agg.user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.recalc_tournament_streaks(_tournament_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s RECORD; u RECORD; cur INT; best INT;
  bonus NUMERIC(10,1);
  v_threshold INT; v_bonus NUMERIC(4,1); v_enabled BOOLEAN; v_comp UUID;
BEGIN
  SELECT ts.win_streak_enabled, ts.win_streak_threshold, ts.win_streak_bonus, t.competition_id
  INTO v_enabled, v_threshold, v_bonus, v_comp
  FROM public.tournament_settings ts
  JOIN public.tournaments t ON t.id = ts.tournament_id
  WHERE ts.tournament_id = _tournament_id;

  IF NOT FOUND THEN RETURN; END IF;

  IF NOT COALESCE(v_enabled, false) THEN
    UPDATE public.tournament_member_streaks
    SET current_streak = 0, bonus_points = 0, updated_at = now()
    WHERE tournament_id = _tournament_id;
    RETURN;
  END IF;

  FOR u IN SELECT DISTINCT user_id FROM public.tournament_members WHERE tournament_id = _tournament_id LOOP
    cur := 0; best := 0; bonus := 0;
    FOR s IN
      SELECT COALESCE(p.points, 0) AS points, (p.id IS NOT NULL) AS has_pred
      FROM public.matches m
      LEFT JOIN public.predictions p
        ON p.match_id = m.id AND p.tournament_id = _tournament_id AND p.user_id = u.user_id
      WHERE m.competition_id = v_comp AND m.status = 'finished'
      ORDER BY m.kickoff_at ASC, m.finished_at ASC NULLS LAST, m.id ASC
    LOOP
      IF NOT s.has_pred OR s.points <= 0 THEN
        cur := 0;
      ELSE
        cur := cur + 1;
        IF cur > best THEN best := cur; END IF;
        IF v_threshold > 0 AND cur % v_threshold = 0 THEN
          bonus := bonus + COALESCE(v_bonus, 0);
        END IF;
      END IF;
    END LOOP;

    INSERT INTO public.tournament_member_streaks (
      tournament_id, user_id, current_streak, best_streak, bonus_points, updated_at
    ) VALUES (_tournament_id, u.user_id, cur, best, bonus, now())
    ON CONFLICT (tournament_id, user_id) DO UPDATE
    SET current_streak = EXCLUDED.current_streak,
        best_streak = GREATEST(public.tournament_member_streaks.best_streak, EXCLUDED.best_streak),
        bonus_points = EXCLUDED.bonus_points,
        updated_at = now();
  END LOOP;
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
        THEN (calc.points::NUMERIC(10,1) * GREATEST(COALESCE(ts.wildcard_multiplier, 1), 1))::NUMERIC(10,1)
      ELSE calc.points::NUMERIC(10,1)
    END,
    exact = calc.exact
  FROM public.user_match_picks pk,
       public.tournament_settings ts,
       LATERAL public.calc_prediction_points(
         pk.home_pred, pk.away_pred, NEW.home_score, NEW.away_score,
         ts.points_outcome, ts.points_exact_bonus,
         pk.et_home_pred, pk.et_away_pred, pk.pen_home_pred, pk.pen_away_pred,
         NEW.et_home_score, NEW.et_away_score, NEW.pen_home_score, NEW.pen_away_score,
         COALESCE(v_knockout, false)
       ) AS calc
  WHERE p.match_id = NEW.id
    AND pk.id = p.pick_id
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

REVOKE ALL ON FUNCTION public.recalc_match_predictions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recalc_match_predictions() TO service_role;

-- =============================================================================
-- 4. Leaderboard enrichment + tiebreak fields
-- =============================================================================
DROP VIEW IF EXISTS public.tournament_leaderboard;
DROP FUNCTION IF EXISTS public.get_tournament_leaderboard(uuid);
DROP FUNCTION IF EXISTS private.current_user_leaderboard();

CREATE OR REPLACE FUNCTION private.current_user_leaderboard()
RETURNS TABLE (
  tournament_id uuid,
  user_id uuid,
  display_name text,
  avatar_url text,
  total_points numeric,
  correct_count integer,
  exact_count integer,
  predictions_made integer,
  special_bets_points numeric,
  streak_bonus_points numeric,
  current_streak integer,
  best_streak integer,
  wildcards_used integer,
  withdrawn_at timestamptz,
  winner_team_id uuid,
  winner_team_name text,
  support_team_id uuid,
  support_team_name text,
  support_advances integer,
  top_scorer_name text,
  top_scorer_goals integer,
  best_defense_team_id uuid,
  best_defense_team_name text
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
    (
      COALESCE(tm.pred_points, 0)
      + COALESCE(tm.special_bets_points, 0)
      + COALESCE(st.bonus_points, 0)
    )::NUMERIC(10,1) AS total_points,
    COALESCE(tm.correct_count, 0)::INT,
    COALESCE(tm.exact_count, 0)::INT,
    COALESCE(tm.predictions_made, 0)::INT,
    COALESCE(tm.special_bets_points, 0)::NUMERIC(10,1),
    COALESCE(st.bonus_points, 0)::NUMERIC(10,1),
    COALESCE(st.current_streak, 0)::INT,
    COALESCE(st.best_streak, 0)::INT,
    COALESCE(tm.wildcards_used, 0)::INT,
    tm.withdrawn_at,
    sb_w.team_id AS winner_team_id,
    ct_w.name AS winner_team_name,
    sb_s.team_id AS support_team_id,
    ct_s.name AS support_team_name,
    CASE
      WHEN COALESCE(ts.special_bets_enabled, false)
        AND COALESCE(ts.special_bet_support_team_enabled, false)
        AND sb_s.team_id IS NOT NULL
      THEN private.count_support_team_advances(t.competition_id, sb_s.team_id)
      ELSE NULL
    END AS support_advances,
    sb_ts.value AS top_scorer_name,
    CASE
      WHEN COALESCE(ts.special_bets_enabled, false)
        AND COALESCE(ts.special_bet_top_scorer_enabled, false)
        AND ts.top_scorer_mode = 'per_goal'
        AND ts.official_top_scorer IS NOT NULL
        AND sb_ts.value IS NOT NULL
        AND lower(trim(sb_ts.value)) = lower(trim(ts.official_top_scorer))
      THEN ts.official_top_scorer_goals
      ELSE NULL
    END AS top_scorer_goals,
    sb_bd.team_id AS best_defense_team_id,
    ct_bd.name AS best_defense_team_name
  FROM public.tournament_members tm
  JOIN public.tournaments t ON t.id = tm.tournament_id
  LEFT JOIN public.tournament_settings ts ON ts.tournament_id = tm.tournament_id
  LEFT JOIN public.profiles pr ON pr.id = tm.user_id
  LEFT JOIN public.tournament_member_streaks st
    ON st.tournament_id = tm.tournament_id AND st.user_id = tm.user_id
  LEFT JOIN public.special_bets sb_w
    ON sb_w.tournament_id = tm.tournament_id AND sb_w.user_id = tm.user_id AND sb_w.bet_type = 'winner'
  LEFT JOIN public.competition_teams ct_w ON ct_w.id = sb_w.team_id
  LEFT JOIN public.special_bets sb_s
    ON sb_s.tournament_id = tm.tournament_id AND sb_s.user_id = tm.user_id AND sb_s.bet_type = 'support_team'
  LEFT JOIN public.competition_teams ct_s ON ct_s.id = sb_s.team_id
  LEFT JOIN public.special_bets sb_ts
    ON sb_ts.tournament_id = tm.tournament_id AND sb_ts.user_id = tm.user_id AND sb_ts.bet_type = 'top_scorer'
  LEFT JOIN public.special_bets sb_bd
    ON sb_bd.tournament_id = tm.tournament_id AND sb_bd.user_id = tm.user_id AND sb_bd.bet_type = 'best_defense'
  LEFT JOIN public.competition_teams ct_bd ON ct_bd.id = sb_bd.team_id
  WHERE private.is_tournament_member(tm.tournament_id);
$$;

CREATE OR REPLACE FUNCTION public.get_tournament_leaderboard(_tournament_id uuid)
RETURNS TABLE (
  tournament_id uuid,
  user_id uuid,
  display_name text,
  avatar_url text,
  total_points numeric,
  correct_count integer,
  exact_count integer,
  predictions_made integer,
  special_bets_points numeric,
  streak_bonus_points numeric,
  current_streak integer,
  best_streak integer,
  wildcards_used integer,
  withdrawn_at timestamptz,
  winner_team_id uuid,
  winner_team_name text,
  support_team_id uuid,
  support_team_name text,
  support_advances integer,
  top_scorer_name text,
  top_scorer_goals integer,
  best_defense_team_id uuid,
  best_defense_team_name text
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
    (
      COALESCE(tm.pred_points, 0)
      + COALESCE(tm.special_bets_points, 0)
      + COALESCE(st.bonus_points, 0)
    )::NUMERIC(10,1) AS total_points,
    COALESCE(tm.correct_count, 0)::INT,
    COALESCE(tm.exact_count, 0)::INT,
    COALESCE(tm.predictions_made, 0)::INT,
    COALESCE(tm.special_bets_points, 0)::NUMERIC(10,1),
    COALESCE(st.bonus_points, 0)::NUMERIC(10,1),
    COALESCE(st.current_streak, 0)::INT,
    COALESCE(st.best_streak, 0)::INT,
    COALESCE(tm.wildcards_used, 0)::INT,
    tm.withdrawn_at,
    sb_w.team_id AS winner_team_id,
    ct_w.name AS winner_team_name,
    sb_s.team_id AS support_team_id,
    ct_s.name AS support_team_name,
    CASE
      WHEN COALESCE(ts.special_bets_enabled, false)
        AND COALESCE(ts.special_bet_support_team_enabled, false)
        AND sb_s.team_id IS NOT NULL
      THEN private.count_support_team_advances(t.competition_id, sb_s.team_id)
      ELSE NULL
    END AS support_advances,
    sb_ts.value AS top_scorer_name,
    CASE
      WHEN COALESCE(ts.special_bets_enabled, false)
        AND COALESCE(ts.special_bet_top_scorer_enabled, false)
        AND ts.top_scorer_mode = 'per_goal'
        AND ts.official_top_scorer IS NOT NULL
        AND sb_ts.value IS NOT NULL
        AND lower(trim(sb_ts.value)) = lower(trim(ts.official_top_scorer))
      THEN ts.official_top_scorer_goals
      ELSE NULL
    END AS top_scorer_goals,
    sb_bd.team_id AS best_defense_team_id,
    ct_bd.name AS best_defense_team_name
  FROM public.tournament_members tm
  JOIN public.tournaments t ON t.id = tm.tournament_id
  LEFT JOIN public.tournament_settings ts ON ts.tournament_id = tm.tournament_id
  LEFT JOIN public.profiles pr ON pr.id = tm.user_id
  LEFT JOIN public.tournament_member_streaks st
    ON st.tournament_id = tm.tournament_id AND st.user_id = tm.user_id
  LEFT JOIN public.special_bets sb_w
    ON sb_w.tournament_id = tm.tournament_id AND sb_w.user_id = tm.user_id AND sb_w.bet_type = 'winner'
  LEFT JOIN public.competition_teams ct_w ON ct_w.id = sb_w.team_id
  LEFT JOIN public.special_bets sb_s
    ON sb_s.tournament_id = tm.tournament_id AND sb_s.user_id = tm.user_id AND sb_s.bet_type = 'support_team'
  LEFT JOIN public.competition_teams ct_s ON ct_s.id = sb_s.team_id
  LEFT JOIN public.special_bets sb_ts
    ON sb_ts.tournament_id = tm.tournament_id AND sb_ts.user_id = tm.user_id AND sb_ts.bet_type = 'top_scorer'
  LEFT JOIN public.special_bets sb_bd
    ON sb_bd.tournament_id = tm.tournament_id AND sb_bd.user_id = tm.user_id AND sb_bd.bet_type = 'best_defense'
  LEFT JOIN public.competition_teams ct_bd ON ct_bd.id = sb_bd.team_id
  WHERE tm.tournament_id = _tournament_id
    AND private.is_tournament_member(_tournament_id);
$$;

REVOKE ALL ON FUNCTION public.get_tournament_leaderboard(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_tournament_leaderboard(uuid) TO authenticated;

-- Refresh dependent view
CREATE OR REPLACE VIEW public.tournament_leaderboard
WITH (security_invoker = true)
AS
SELECT * FROM private.current_user_leaderboard();

GRANT SELECT ON public.tournament_leaderboard TO authenticated;

-- =============================================================================
-- 5. Post-kickoff history RPCs
-- =============================================================================
CREATE OR REPLACE FUNCTION public.list_user_tournament_predictions(
  _tournament_id uuid,
  _user_id uuid
)
RETURNS TABLE (
  match_id uuid,
  kickoff_at timestamptz,
  status public.match_status,
  home_team_name text,
  away_team_name text,
  home_score integer,
  away_score integer,
  home_pred integer,
  away_pred integer,
  points numeric,
  exact boolean,
  is_wildcard boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT private.is_tournament_member(_tournament_id) THEN
    RAISE EXCEPTION 'not a tournament member' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.tournament_members tm
    WHERE tm.tournament_id = _tournament_id AND tm.user_id = _user_id
  ) THEN
    RAISE EXCEPTION 'user is not a member' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  SELECT
    m.id AS match_id,
    m.kickoff_at,
    m.status,
    ht.name AS home_team_name,
    at.name AS away_team_name,
    m.home_score,
    m.away_score,
    pk.home_pred,
    pk.away_pred,
    p.points,
    p.exact,
    p.is_wildcard
  FROM public.predictions p
  JOIN public.user_match_picks pk ON pk.id = p.pick_id
  JOIN public.matches m ON m.id = p.match_id
  LEFT JOIN public.competition_teams ht ON ht.id = m.home_team_id
  LEFT JOIN public.competition_teams at ON at.id = m.away_team_id
  WHERE p.tournament_id = _tournament_id
    AND p.user_id = _user_id
    AND m.kickoff_at <= now()
  ORDER BY m.kickoff_at DESC, m.id DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_match_tournament_predictions(
  _tournament_id uuid,
  _match_id uuid
)
RETURNS TABLE (
  user_id uuid,
  display_name text,
  home_pred integer,
  away_pred integer,
  points numeric,
  exact boolean,
  is_wildcard boolean,
  withdrawn_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kickoff timestamptz;
  v_comp uuid;
  v_t_comp uuid;
BEGIN
  IF NOT private.is_tournament_member(_tournament_id) THEN
    RAISE EXCEPTION 'not a tournament member' USING ERRCODE = '42501';
  END IF;

  SELECT m.kickoff_at, m.competition_id INTO v_kickoff, v_comp
  FROM public.matches m WHERE m.id = _match_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'match not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT t.competition_id INTO v_t_comp FROM public.tournaments t WHERE t.id = _tournament_id;
  IF v_t_comp IS DISTINCT FROM v_comp THEN
    RAISE EXCEPTION 'match not in tournament competition' USING ERRCODE = 'P0001';
  END IF;

  IF v_kickoff > now() THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    p.user_id,
    pr.display_name,
    pk.home_pred,
    pk.away_pred,
    p.points,
    p.exact,
    p.is_wildcard,
    tm.withdrawn_at
  FROM public.predictions p
  JOIN public.user_match_picks pk ON pk.id = p.pick_id
  LEFT JOIN public.profiles pr ON pr.id = p.user_id
  LEFT JOIN public.tournament_members tm
    ON tm.tournament_id = p.tournament_id AND tm.user_id = p.user_id
  WHERE p.tournament_id = _tournament_id
    AND p.match_id = _match_id
  ORDER BY p.points DESC NULLS LAST, pr.display_name ASC NULLS LAST;
END;
$$;

REVOKE ALL ON FUNCTION public.list_user_tournament_predictions(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_match_tournament_predictions(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_user_tournament_predictions(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_match_tournament_predictions(uuid, uuid) TO authenticated;
