-- Win streak: bonus on every correct AFTER reaching threshold (not every N).
-- History RPCs: include finished/live matches even if kickoff is still in the future (manual results).

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
        -- After N consecutive correct, every further correct earns the bonus until break.
        IF v_threshold > 0 AND cur > v_threshold THEN
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
    AND (
      m.kickoff_at <= now()
      OR m.status IN ('live', 'finished')
    )
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
  v_status public.match_status;
  v_comp uuid;
  v_t_comp uuid;
BEGIN
  IF NOT private.is_tournament_member(_tournament_id) THEN
    RAISE EXCEPTION 'not a tournament member' USING ERRCODE = '42501';
  END IF;

  SELECT m.kickoff_at, m.status, m.competition_id
  INTO v_kickoff, v_status, v_comp
  FROM public.matches m WHERE m.id = _match_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'match not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT t.competition_id INTO v_t_comp FROM public.tournaments t WHERE t.id = _tournament_id;
  IF v_t_comp IS DISTINCT FROM v_comp THEN
    RAISE EXCEPTION 'match not in tournament competition' USING ERRCODE = 'P0001';
  END IF;

  IF v_kickoff > now() AND v_status NOT IN ('live', 'finished') THEN
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

-- Recalc streaks for all tournaments with the module enabled
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT tournament_id FROM public.tournament_settings WHERE win_streak_enabled = true
  LOOP
    PERFORM public.recalc_tournament_streaks(r.tournament_id);
  END LOOP;
END $$;
