-- per_goal must score EACH pick from player_season_stats, not only the current
-- official #1 name. support_team_mode overwrote that logic on 2026-07-24.

CREATE OR REPLACE FUNCTION public.recalc_special_bets(_tournament_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings public.tournament_settings%ROWTYPE;
  v_comp UUID;
  v_season TEXT;
  r RECORD;
  v_advances INT;
  v_x INT;
  v_champ BOOLEAN;
  v_pts INT;
  v_goals INT;
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

  SELECT t.competition_id, c.season
    INTO v_comp, v_season
  FROM public.tournaments t
  JOIN public.competitions c ON c.id = t.competition_id
  WHERE t.id = _tournament_id;

  UPDATE public.special_bets sb
  SET points = CASE
    WHEN v_settings.special_bet_winner_enabled AND v_settings.official_winner_team_id IS NOT NULL
      AND sb.team_id = v_settings.official_winner_team_id
    THEN COALESCE(v_settings.points_winner, 0) ELSE 0 END,
    updated_at = now()
  WHERE sb.tournament_id = _tournament_id AND sb.bet_type = 'winner';

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
          v_goals := COALESCE(v_goals, 0);
        ELSIF v_settings.official_top_scorer IS NOT NULL
          AND lower(trim(COALESCE(r.value, ''))) = lower(trim(v_settings.official_top_scorer)) THEN
          v_goals := COALESCE(v_settings.official_top_scorer_goals, 0);
        END IF;
        v_pts := COALESCE(v_goals, 0) * COALESCE(v_settings.points_top_scorer_per_goal, 1);
      ELSE
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
