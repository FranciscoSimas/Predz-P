-- Fix attach_existing_picks to use new calc_prediction_points signature

CREATE OR REPLACE FUNCTION private.attach_existing_picks(
  _tournament_id uuid,
  _user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_comp uuid;
  v_knockout boolean;
  r record;
BEGIN
  SELECT competition_id INTO v_comp
  FROM public.tournaments
  WHERE id = _tournament_id;

  IF v_comp IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.predictions (tournament_id, user_id, match_id, pick_id, is_wildcard)
  SELECT _tournament_id, _user_id, pk.match_id, pk.id, false
  FROM public.user_match_picks pk
  JOIN public.matches m ON m.id = pk.match_id
  WHERE pk.user_id = _user_id
    AND m.competition_id = v_comp
  ON CONFLICT (tournament_id, user_id, match_id) DO NOTHING;

  SELECT c.format IN (
    'groups_then_knockout',
    'league_phase_then_knockout',
    'groups_then_finals',
    'knockout_only'
  )
  INTO v_knockout
  FROM public.competitions c
  WHERE c.id = v_comp;

  -- Score finished matches via the current calc signature (incl. breakdown).
  FOR r IN
    SELECT DISTINCT m.id
    FROM public.predictions p
    JOIN public.matches m ON m.id = p.match_id
    WHERE p.tournament_id = _tournament_id
      AND p.user_id = _user_id
      AND m.home_score IS NOT NULL
      AND m.away_score IS NOT NULL
  LOOP
    PERFORM public.recalc_predictions_for_match(r.id);
  END LOOP;

  PERFORM public.refresh_member_pred_stats(_tournament_id, _user_id);
  PERFORM public.recalc_tournament_streaks(_tournament_id);
END;
$$;

REVOKE ALL ON FUNCTION private.attach_existing_picks(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.attach_existing_picks(uuid, uuid) TO service_role;

-- Compatibility shim: old boolean knockout flag → new scoring (league vs single).
CREATE OR REPLACE FUNCTION public.calc_prediction_points(
  _home_pred int,
  _away_pred int,
  _home_score int,
  _away_score int,
  _p_outcome int,
  _p_exact_bonus int,
  _et_home_pred int DEFAULT NULL,
  _et_away_pred int DEFAULT NULL,
  _pen_home_pred int DEFAULT NULL,
  _pen_away_pred int DEFAULT NULL,
  _et_home_score int DEFAULT NULL,
  _et_away_score int DEFAULT NULL,
  _pen_home_score int DEFAULT NULL,
  _pen_away_score int DEFAULT NULL,
  _is_knockout boolean DEFAULT false
)
RETURNS TABLE(points int, exact boolean)
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT c.points, c.exact
  FROM public.calc_prediction_points(
    _home_pred, _away_pred, _home_score, _away_score,
    _p_outcome, _p_exact_bonus,
    _et_home_pred, _et_away_pred, _pen_home_pred, _pen_away_pred,
    _et_home_score, _et_away_score, _pen_home_score, _pen_away_score,
    CASE WHEN COALESCE(_is_knockout, false) THEN 'single'::text ELSE NULL END,
    NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid,
    NULL::int, NULL::int, NULL::int, NULL::int
  ) AS c;
$$;

REVOKE ALL ON FUNCTION public.calc_prediction_points(
  int, int, int, int, int, int, int, int, int, int, int, int, int, int, boolean
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calc_prediction_points(
  int, int, int, int, int, int, int, int, int, int, int, int, int, int, boolean
) TO service_role;
