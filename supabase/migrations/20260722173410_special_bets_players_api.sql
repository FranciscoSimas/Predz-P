-- Special bets: players, season stats, id-based scoring, API/sync-driven officials.
-- Applied via MCP to elvugliesovatwaatwnl — do not re-apply blindly.

-- ---------------------------------------------------------------------------
-- 1. Tables: competition_players + player_season_stats
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.competition_players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id UUID NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  team_id UUID REFERENCES public.competition_teams(id) ON DELETE SET NULL,
  external_id TEXT NOT NULL,
  name TEXT NOT NULL,
  photo_url TEXT,
  position TEXT,
  shirt_number INT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (competition_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_competition_players_team
  ON public.competition_players(competition_id, team_id);

CREATE TABLE IF NOT EXISTS public.player_season_stats (
  competition_id UUID NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  player_external_id TEXT NOT NULL,
  season TEXT NOT NULL,
  goals INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (competition_id, player_external_id, season)
);

ALTER TABLE public.special_bets
  ADD COLUMN IF NOT EXISTS player_external_id TEXT;

ALTER TABLE public.tournament_settings
  ADD COLUMN IF NOT EXISTS official_top_scorer_external_id TEXT;

-- ---------------------------------------------------------------------------
-- 2. RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.competition_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_season_stats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "competition_players select members" ON public.competition_players;
CREATE POLICY "competition_players select members"
  ON public.competition_players FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.tournaments t
      JOIN public.tournament_members tm ON tm.tournament_id = t.id
      WHERE t.competition_id = competition_players.competition_id
        AND tm.user_id = auth.uid()
    )
    OR private.is_platform_admin()
  );

DROP POLICY IF EXISTS "player_season_stats select members" ON public.player_season_stats;
CREATE POLICY "player_season_stats select members"
  ON public.player_season_stats FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.tournaments t
      JOIN public.tournament_members tm ON tm.tournament_id = t.id
      WHERE t.competition_id = player_season_stats.competition_id
        AND tm.user_id = auth.uid()
    )
    OR private.is_platform_admin()
  );

GRANT SELECT ON public.competition_players TO authenticated;
GRANT SELECT ON public.player_season_stats TO authenticated;

-- service_role / sync writes via key (bypasses RLS)

-- ---------------------------------------------------------------------------
-- 3. special_bets grants: allow player_external_id from client
-- ---------------------------------------------------------------------------
REVOKE INSERT, UPDATE ON TABLE public.special_bets FROM authenticated;

GRANT INSERT (
  tournament_id,
  user_id,
  bet_type,
  value,
  team_id,
  player_external_id
) ON public.special_bets TO authenticated;

GRANT UPDATE (
  tournament_id,
  user_id,
  bet_type,
  value,
  team_id,
  player_external_id
) ON public.special_bets TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. recalc_special_bets — per_goal = goals of pick; player_match by external id
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recalc_special_bets(_tournament_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings RECORD;
  v_comp UUID;
  v_season TEXT;
  r RECORD;
  v_advances INT;
  v_x INT;
  v_champ BOOLEAN;
  v_pts INT;
  v_goals INT;
BEGIN
  -- Alias must NOT be named like the RECORD target (SELECT ts.* INTO ts fails).
  SELECT
    s.*,
    t.competition_id AS competition_id,
    c.season AS competition_season
  INTO v_settings
  FROM public.tournament_settings s
  JOIN public.tournaments t ON t.id = s.tournament_id
  JOIN public.competitions c ON c.id = t.competition_id
  WHERE s.tournament_id = _tournament_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF NOT COALESCE(v_settings.special_bets_enabled, false) THEN
    UPDATE public.special_bets SET points = 0, updated_at = now()
    WHERE tournament_id = _tournament_id;
    PERFORM public.refresh_member_special_bets_points(_tournament_id, tm.user_id)
    FROM public.tournament_members tm
    WHERE tm.tournament_id = _tournament_id;
    RETURN;
  END IF;

  v_comp := v_settings.competition_id;
  v_season := v_settings.competition_season;

  UPDATE public.special_bets sb
  SET points = CASE
    WHEN v_settings.special_bet_winner_enabled AND v_settings.official_winner_team_id IS NOT NULL
      AND sb.team_id = v_settings.official_winner_team_id
    THEN COALESCE(v_settings.points_winner, 0) ELSE 0 END,
    updated_at = now()
  WHERE sb.tournament_id = _tournament_id AND sb.bet_type = 'winner';

  -- Top scorer
  FOR r IN
    SELECT sb.id, sb.value, sb.player_external_id
    FROM public.special_bets sb
    WHERE sb.tournament_id = _tournament_id AND sb.bet_type = 'top_scorer'
  LOOP
    v_pts := 0;
    IF COALESCE(v_settings.special_bet_top_scorer_enabled, false) THEN
      IF v_settings.top_scorer_mode = 'per_goal' THEN
        v_goals := 0;
        IF r.player_external_id IS NOT NULL THEN
          SELECT COALESCE(pss.goals, 0) INTO v_goals
          FROM public.player_season_stats pss
          WHERE pss.competition_id = v_comp
            AND pss.season = v_season
            AND pss.player_external_id = r.player_external_id;
        ELSIF v_settings.official_top_scorer IS NOT NULL
          AND lower(trim(COALESCE(r.value, ''))) = lower(trim(v_settings.official_top_scorer)) THEN
          v_goals := COALESCE(v_settings.official_top_scorer_goals, 0);
        END IF;
        v_pts := COALESCE(v_goals, 0) * COALESCE(v_settings.points_top_scorer_per_goal, 1);
      ELSE
        -- player_match: must pick the official #1
        IF (
          v_settings.official_top_scorer_external_id IS NOT NULL
          AND r.player_external_id IS NOT NULL
          AND r.player_external_id = v_settings.official_top_scorer_external_id
        ) OR (
          v_settings.official_top_scorer IS NOT NULL
          AND lower(trim(COALESCE(r.value, ''))) = lower(trim(v_settings.official_top_scorer))
        ) THEN
          v_pts := COALESCE(v_settings.points_top_scorer, 0);
        END IF;
      END IF;
    END IF;

    UPDATE public.special_bets
    SET points = v_pts, updated_at = now()
    WHERE id = r.id;
  END LOOP;

  UPDATE public.special_bets sb
  SET points = CASE
    WHEN v_settings.special_bet_best_defense_enabled AND v_settings.official_best_defense_team_id IS NOT NULL
      AND sb.team_id = v_settings.official_best_defense_team_id
    THEN COALESCE(v_settings.points_best_defense, 0) ELSE 0 END,
    updated_at = now()
  WHERE sb.tournament_id = _tournament_id AND sb.bet_type = 'best_defense';

  v_x := GREATEST(COALESCE(v_settings.points_support_advance, 0), 0);
  FOR r IN
    SELECT sb.id, sb.team_id, sb.user_id
    FROM public.special_bets sb
    WHERE sb.tournament_id = _tournament_id AND sb.bet_type = 'support_team'
  LOOP
    IF NOT COALESCE(v_settings.special_bet_support_team_enabled, false) OR r.team_id IS NULL THEN
      v_pts := 0;
    ELSE
      v_advances := private.count_support_team_advances(v_comp, r.team_id);
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

-- Trigger also on official_top_scorer_external_id
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

-- ---------------------------------------------------------------------------
-- 5. Leaderboard: top_scorer_goals from player_season_stats for the pick
-- ---------------------------------------------------------------------------
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
        AND sb_ts.player_external_id IS NOT NULL
      THEN (
        SELECT pss.goals
        FROM public.player_season_stats pss
        WHERE pss.competition_id = t.competition_id
          AND pss.season = c.season
          AND pss.player_external_id = sb_ts.player_external_id
      )
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
  JOIN public.competitions c ON c.id = t.competition_id
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
        AND sb_ts.player_external_id IS NOT NULL
      THEN (
        SELECT pss.goals
        FROM public.player_season_stats pss
        WHERE pss.competition_id = t.competition_id
          AND pss.season = c.season
          AND pss.player_external_id = sb_ts.player_external_id
      )
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
  JOIN public.competitions c ON c.id = t.competition_id
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
GRANT EXECUTE ON FUNCTION public.get_tournament_leaderboard(uuid) TO authenticated, service_role;

CREATE OR REPLACE VIEW public.tournament_leaderboard
WITH (security_invoker = true)
AS
SELECT * FROM private.current_user_leaderboard();

GRANT SELECT ON public.tournament_leaderboard TO authenticated;

-- Helper for sync: recalc all tournaments of a competition
CREATE OR REPLACE FUNCTION public.recalc_special_bets_for_competition(_competition_id UUID)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n INT := 0;
  tid UUID;
BEGIN
  FOR tid IN
    SELECT id FROM public.tournaments WHERE competition_id = _competition_id
  LOOP
    PERFORM public.recalc_special_bets(tid);
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.recalc_special_bets_for_competition(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recalc_special_bets_for_competition(UUID) TO service_role;
