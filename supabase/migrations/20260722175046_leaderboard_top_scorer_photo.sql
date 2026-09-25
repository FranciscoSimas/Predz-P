-- Ranking: top scorer photo; recreate leaderboard RPCs (+ view) with new column.

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
  top_scorer_photo_url text,
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
    cp_ts.photo_url AS top_scorer_photo_url,
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
  LEFT JOIN public.competition_players cp_ts
    ON cp_ts.competition_id = t.competition_id
    AND cp_ts.external_id = sb_ts.player_external_id
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
  top_scorer_photo_url text,
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
    cp_ts.photo_url AS top_scorer_photo_url,
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
  LEFT JOIN public.competition_players cp_ts
    ON cp_ts.competition_id = t.competition_id
    AND cp_ts.external_id = sb_ts.player_external_id
  LEFT JOIN public.special_bets sb_bd
    ON sb_bd.tournament_id = tm.tournament_id AND sb_bd.user_id = tm.user_id AND sb_bd.bet_type = 'best_defense'
  LEFT JOIN public.competition_teams ct_bd ON ct_bd.id = sb_bd.team_id
  WHERE tm.tournament_id = _tournament_id
    AND private.is_tournament_member(_tournament_id);
$$;

CREATE OR REPLACE VIEW public.tournament_leaderboard
WITH (security_invoker = true)
AS
SELECT * FROM private.current_user_leaderboard();

REVOKE ALL ON FUNCTION public.get_tournament_leaderboard(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_tournament_leaderboard(uuid) TO authenticated, service_role;
GRANT SELECT ON public.tournament_leaderboard TO authenticated;
