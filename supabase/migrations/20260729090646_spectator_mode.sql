-- Spectator mode
-- Keeps the existing one-argument join RPCs unchanged for production clients.
-- DEV uses the new *_as RPCs to choose player or spectator.

CREATE OR REPLACE FUNCTION private.is_active_tournament_player(_tournament_id uuid)
RETURNS boolean
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
      AND tm.withdrawn_at IS NULL
      AND tm.role <> 'spectator'::public.tournament_role
  );
$$;

REVOKE ALL ON FUNCTION private.is_active_tournament_player(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_active_tournament_player(uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.join_tournament_by_code_as(
  _code text,
  _as_spectator boolean
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tid uuid;
  v_uid uuid := auth.uid();
  v_recent integer;
  v_role public.tournament_role :=
    CASE WHEN COALESCE(_as_spectator, false) THEN 'spectator' ELSE 'member' END;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Autenticação necessária.';
  END IF;

  SELECT COUNT(*)::integer
    INTO v_recent
  FROM private.join_code_attempts
  WHERE user_id = v_uid
    AND attempted_at > now() - interval '15 minutes';

  IF v_recent >= 20 THEN
    RAISE EXCEPTION 'Demasiadas tentativas. Espera alguns minutos e tenta de novo.';
  END IF;

  SELECT id
    INTO v_tid
  FROM public.tournaments
  WHERE join_code = upper(trim(_code));

  IF v_tid IS NULL THEN
    INSERT INTO private.join_code_attempts(user_id, success)
    VALUES (v_uid, false);
    RAISE EXCEPTION 'Torneio não encontrado.';
  END IF;

  INSERT INTO public.tournament_members (tournament_id, user_id, role)
  VALUES (v_tid, v_uid, v_role)
  ON CONFLICT (tournament_id, user_id) DO NOTHING;

  INSERT INTO private.join_code_attempts(user_id, success)
  VALUES (v_uid, true);

  IF v_role <> 'spectator'::public.tournament_role THEN
    PERFORM private.attach_existing_picks(v_tid, v_uid);
  END IF;

  DELETE FROM private.join_code_attempts
  WHERE attempted_at < now() - interval '7 days';

  RETURN v_tid;
END;
$$;

REVOKE ALL ON FUNCTION public.join_tournament_by_code_as(text, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_tournament_by_code_as(text, boolean)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.join_public_tournament_as(
  _tournament_id uuid,
  _as_spectator boolean
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_public boolean;
  v_role public.tournament_role :=
    CASE WHEN COALESCE(_as_spectator, false) THEN 'spectator' ELSE 'member' END;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Autenticação necessária.';
  END IF;

  SELECT t.is_public
    INTO v_public
  FROM public.tournaments t
  WHERE t.id = _tournament_id;

  IF v_public IS NULL THEN
    RAISE EXCEPTION 'Torneio não encontrado.';
  END IF;
  IF NOT v_public THEN
    RAISE EXCEPTION 'Este torneio não é público. Usa o código de convite.';
  END IF;

  INSERT INTO public.tournament_members (tournament_id, user_id, role)
  VALUES (_tournament_id, v_uid, v_role)
  ON CONFLICT (tournament_id, user_id) DO NOTHING;

  IF v_role <> 'spectator'::public.tournament_role THEN
    PERFORM private.attach_existing_picks(_tournament_id, v_uid);
  END IF;

  RETURN _tournament_id;
END;
$$;

REVOKE ALL ON FUNCTION public.join_public_tournament_as(uuid, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_public_tournament_as(uuid, boolean)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.prediction_context_valid(
  _tournament_id uuid,
  _match_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.is_active_tournament_player(_tournament_id)
    AND EXISTS (
      SELECT 1
      FROM public.tournaments t
      JOIN public.matches m ON m.competition_id = t.competition_id
      WHERE t.id = _tournament_id
        AND m.id = _match_id
    );
$$;

CREATE OR REPLACE FUNCTION public.upsert_shared_match_prediction(
  _match_id uuid,
  _home_pred integer,
  _away_pred integer,
  _et_home_pred integer DEFAULT NULL,
  _et_away_pred integer DEFAULT NULL,
  _pen_home_pred integer DEFAULT NULL,
  _pen_away_pred integer DEFAULT NULL,
  _is_wildcard boolean DEFAULT false,
  _tournament_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_comp uuid;
  v_kickoff timestamptz;
  v_status public.match_status;
  v_pick_id uuid;
  v_tid uuid;
  v_synced integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF _home_pred IS NULL OR _away_pred IS NULL THEN
    RAISE EXCEPTION 'home_pred and away_pred are required';
  END IF;
  IF _home_pred < 0 OR _home_pred > 30 OR _away_pred < 0 OR _away_pred > 30 THEN
    RAISE EXCEPTION 'prediction scores must be between 0 and 30';
  END IF;

  SELECT m.competition_id, m.kickoff_at, m.status
    INTO v_comp, v_kickoff, v_status
  FROM public.matches m
  WHERE m.id = _match_id;

  IF v_comp IS NULL THEN
    RAISE EXCEPTION 'match not found';
  END IF;
  IF v_kickoff <= now() OR v_status IN ('live', 'finished') THEN
    RAISE EXCEPTION 'match already started';
  END IF;

  IF _tournament_id IS NOT NULL
    AND NOT private.is_active_tournament_player(_tournament_id) THEN
    RAISE EXCEPTION 'only active players can submit predictions';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.tournaments t
    JOIN public.tournament_members tm
      ON tm.tournament_id = t.id
     AND tm.user_id = v_uid
    WHERE t.competition_id = v_comp
      AND tm.withdrawn_at IS NULL
      AND tm.role <> 'spectator'::public.tournament_role
  ) THEN
    RAISE EXCEPTION 'not an active player in any tournament for this competition';
  END IF;

  INSERT INTO public.user_match_picks AS pk (
    user_id, match_id, home_pred, away_pred,
    et_home_pred, et_away_pred, pen_home_pred, pen_away_pred
  ) VALUES (
    v_uid, _match_id, _home_pred, _away_pred,
    _et_home_pred, _et_away_pred, _pen_home_pred, _pen_away_pred
  )
  ON CONFLICT (user_id, match_id) DO UPDATE SET
    home_pred = EXCLUDED.home_pred,
    away_pred = EXCLUDED.away_pred,
    et_home_pred = COALESCE(EXCLUDED.et_home_pred, pk.et_home_pred),
    et_away_pred = COALESCE(EXCLUDED.et_away_pred, pk.et_away_pred),
    pen_home_pred = COALESCE(EXCLUDED.pen_home_pred, pk.pen_home_pred),
    pen_away_pred = COALESCE(EXCLUDED.pen_away_pred, pk.pen_away_pred),
    updated_at = now()
  RETURNING id INTO v_pick_id;

  FOR v_tid IN
    SELECT t.id
    FROM public.tournaments t
    JOIN public.tournament_members tm
      ON tm.tournament_id = t.id
     AND tm.user_id = v_uid
    WHERE t.competition_id = v_comp
      AND tm.withdrawn_at IS NULL
      AND tm.role <> 'spectator'::public.tournament_role
  LOOP
    INSERT INTO public.predictions AS p (
      tournament_id, user_id, match_id, pick_id, is_wildcard
    ) VALUES (
      v_tid, v_uid, _match_id, v_pick_id,
      CASE WHEN v_tid = COALESCE(_tournament_id, v_tid)
        THEN COALESCE(_is_wildcard, false)
        ELSE false
      END
    )
    ON CONFLICT (tournament_id, user_id, match_id) DO UPDATE SET
      pick_id = EXCLUDED.pick_id,
      is_wildcard = CASE
        WHEN p.tournament_id = COALESCE(_tournament_id, p.tournament_id)
          THEN EXCLUDED.is_wildcard
        ELSE p.is_wildcard
      END,
      updated_at = now();

    v_synced := v_synced + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'synced_tournaments', v_synced,
    'match_id', _match_id,
    'pick_id', v_pick_id
  );
END;
$$;

DROP POLICY IF EXISTS "predictions insert own valid match" ON public.predictions;
CREATE POLICY "predictions insert own valid match"
  ON public.predictions FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND private.prediction_context_valid(tournament_id, match_id)
  );

DROP POLICY IF EXISTS "predictions update own valid match" ON public.predictions;
CREATE POLICY "predictions update own valid match"
  ON public.predictions FOR UPDATE TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND private.is_active_tournament_player(tournament_id)
  )
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND private.prediction_context_valid(tournament_id, match_id)
  );

DROP POLICY IF EXISTS "predictions delete own" ON public.predictions;
CREATE POLICY "predictions delete own"
  ON public.predictions FOR DELETE TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND private.is_active_tournament_player(tournament_id)
  );

DROP POLICY IF EXISTS "special_bets insert own" ON public.special_bets;
CREATE POLICY "special_bets insert own"
  ON public.special_bets FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND private.is_active_tournament_player(tournament_id)
    AND EXISTS (
      SELECT 1
      FROM public.tournament_settings ts
      WHERE ts.tournament_id = special_bets.tournament_id
        AND ts.special_bets_enabled = true
        AND (ts.special_bets_cutoff_at IS NULL OR ts.special_bets_cutoff_at > now())
    )
  );

DROP POLICY IF EXISTS "special_bets update own" ON public.special_bets;
CREATE POLICY "special_bets update own"
  ON public.special_bets FOR UPDATE TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND private.is_active_tournament_player(tournament_id)
  )
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND private.is_active_tournament_player(tournament_id)
    AND EXISTS (
      SELECT 1
      FROM public.tournament_settings ts
      WHERE ts.tournament_id = special_bets.tournament_id
        AND (ts.special_bets_cutoff_at IS NULL OR ts.special_bets_cutoff_at > now())
    )
  );

DROP POLICY IF EXISTS "special_bets delete own" ON public.special_bets;
CREATE POLICY "special_bets delete own"
  ON public.special_bets FOR DELETE TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND private.is_active_tournament_player(tournament_id)
    AND EXISTS (
      SELECT 1
      FROM public.tournament_settings ts
      WHERE ts.tournament_id = special_bets.tournament_id
        AND (ts.special_bets_cutoff_at IS NULL OR ts.special_bets_cutoff_at > now())
    )
  );

DROP POLICY IF EXISTS "tm admin update roles" ON public.tournament_members;
CREATE POLICY "tm admin update roles"
  ON public.tournament_members FOR UPDATE TO authenticated
  USING (
    private.is_tournament_admin(tournament_id)
    AND role <> 'spectator'::public.tournament_role
  )
  WITH CHECK (
    private.is_tournament_admin(tournament_id)
    AND role = ANY (ARRAY[
      'admin'::public.tournament_role,
      'member'::public.tournament_role
    ])
  );

CREATE OR REPLACE FUNCTION public.preview_tournament_by_code(_code text)
RETURNS TABLE (
  id uuid,
  name text,
  description text,
  is_public boolean,
  is_official boolean,
  join_code text,
  competition_name text,
  competition_logo_url text,
  member_count integer,
  already_member boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Autenticação necessária.';
  END IF;

  RETURN QUERY
  SELECT
    t.id,
    t.name,
    t.description,
    t.is_public,
    t.is_official,
    t.join_code,
    c.name,
    c.logo_url,
    (
      SELECT COUNT(*)::integer
      FROM public.tournament_members tm_count
      WHERE tm_count.tournament_id = t.id
        AND tm_count.withdrawn_at IS NULL
        AND tm_count.role <> 'spectator'::public.tournament_role
    ),
    EXISTS (
      SELECT 1
      FROM public.tournament_members tm_me
      WHERE tm_me.tournament_id = t.id
        AND tm_me.user_id = v_uid
    )
  FROM public.tournaments t
  JOIN public.competitions c ON c.id = t.competition_id
  WHERE t.join_code = upper(trim(_code))
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.preview_tournament_by_code(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_tournament_by_code(text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.list_tournament_members(_tournament_id uuid)
RETURNS TABLE (
  user_id uuid,
  role public.tournament_role,
  joined_at timestamptz,
  withdrawn_at timestamptz,
  display_name text,
  avatar_url text
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

  RETURN QUERY
  SELECT
    tm.user_id,
    tm.role,
    tm.joined_at,
    tm.withdrawn_at,
    pr.display_name,
    pr.avatar_url
  FROM public.tournament_members tm
  LEFT JOIN public.profiles pr ON pr.id = tm.user_id
  WHERE tm.tournament_id = _tournament_id
  ORDER BY
    CASE tm.role
      WHEN 'owner'::public.tournament_role THEN 0
      WHEN 'admin'::public.tournament_role THEN 1
      WHEN 'member'::public.tournament_role THEN 2
      ELSE 3
    END,
    tm.joined_at;
END;
$$;

REVOKE ALL ON FUNCTION public.list_tournament_members(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_tournament_members(uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_tournament_leaderboard(_tournament_id uuid)
RETURNS TABLE(
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
    )::numeric(10,1),
    COALESCE(tm.correct_count, 0)::integer,
    COALESCE(tm.exact_count, 0)::integer,
    COALESCE(tm.predictions_made, 0)::integer,
    COALESCE(tm.special_bets_points, 0)::numeric(10,1),
    COALESCE(st.bonus_points, 0)::numeric(10,1),
    COALESCE(st.current_streak, 0)::integer,
    COALESCE(st.best_streak, 0)::integer,
    COALESCE(tm.wildcards_used, 0)::integer,
    tm.withdrawn_at,
    sb_w.team_id,
    ct_w.name,
    sb_s.team_id,
    ct_s.name,
    CASE
      WHEN COALESCE(ts.special_bets_enabled, false)
        AND COALESCE(ts.special_bet_support_team_enabled, false)
        AND sb_s.team_id IS NOT NULL
      THEN private.count_support_team_advances(t.competition_id, sb_s.team_id)
      ELSE NULL
    END,
    sb_ts.value,
    cp_ts.photo_url,
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
    END,
    sb_bd.team_id,
    ct_bd.name
  FROM public.tournament_members tm
  JOIN public.tournaments t ON t.id = tm.tournament_id
  JOIN public.competitions c ON c.id = t.competition_id
  LEFT JOIN public.tournament_settings ts ON ts.tournament_id = tm.tournament_id
  LEFT JOIN public.profiles pr ON pr.id = tm.user_id
  LEFT JOIN public.tournament_member_streaks st
    ON st.tournament_id = tm.tournament_id AND st.user_id = tm.user_id
  LEFT JOIN public.special_bets sb_w
    ON sb_w.tournament_id = tm.tournament_id
   AND sb_w.user_id = tm.user_id
   AND sb_w.bet_type = 'winner'
  LEFT JOIN public.competition_teams ct_w ON ct_w.id = sb_w.team_id
  LEFT JOIN public.special_bets sb_s
    ON sb_s.tournament_id = tm.tournament_id
   AND sb_s.user_id = tm.user_id
   AND sb_s.bet_type = 'support_team'
  LEFT JOIN public.competition_teams ct_s ON ct_s.id = sb_s.team_id
  LEFT JOIN public.special_bets sb_ts
    ON sb_ts.tournament_id = tm.tournament_id
   AND sb_ts.user_id = tm.user_id
   AND sb_ts.bet_type = 'top_scorer'
  LEFT JOIN public.competition_players cp_ts
    ON cp_ts.competition_id = t.competition_id
   AND cp_ts.external_id = sb_ts.player_external_id
  LEFT JOIN public.special_bets sb_bd
    ON sb_bd.tournament_id = tm.tournament_id
   AND sb_bd.user_id = tm.user_id
   AND sb_bd.bet_type = 'best_defense'
  LEFT JOIN public.competition_teams ct_bd ON ct_bd.id = sb_bd.team_id
  WHERE tm.tournament_id = _tournament_id
    AND tm.role <> 'spectator'::public.tournament_role
    AND private.is_tournament_member(_tournament_id);
$$;

REVOKE ALL ON FUNCTION public.get_tournament_leaderboard(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_tournament_leaderboard(uuid)
  TO authenticated, service_role;

CREATE OR REPLACE VIEW public.tournament_leaderboard
WITH (security_invoker = true)
AS
SELECT lb.*
FROM private.current_user_leaderboard() lb
WHERE EXISTS (
  SELECT 1
  FROM public.tournament_members tm
  WHERE tm.tournament_id = lb.tournament_id
    AND tm.user_id = lb.user_id
    AND tm.role <> 'spectator'::public.tournament_role
);

GRANT SELECT ON public.tournament_leaderboard TO authenticated;
