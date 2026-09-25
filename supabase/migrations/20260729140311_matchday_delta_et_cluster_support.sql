-- 1) Delta poll: compare 90'/ET/PEN like Go sync (not goals, which include ET).
-- 2) Cluster open window: 210m for knockout / ET-capable legs; 150m otherwise.
-- 3) UCL/EL support-team defaults: per_phase + 7 pts.

-- ---------------------------------------------------------------------------
-- Knockout phase heuristic (include play-offs)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.is_knockout_bracket_phase(_phase text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN _phase IS NULL THEN false
    WHEN lower(_phase) IN (
      'round_of_16', 'quarter_finals', 'semi_finals', 'final',
      'last_16', 'last16', 'quarter-finals', 'semi-finals'
    ) THEN true
    WHEN lower(_phase) LIKE '%round_of%' OR lower(_phase) LIKE '%last_1%' THEN true
    WHEN lower(_phase) LIKE '%quarter%' OR lower(_phase) LIKE '%semi%' THEN true
    WHEN lower(_phase) LIKE '%play%off%' OR lower(_phase) LIKE '%knockout%' THEN true
    WHEN lower(_phase) = 'final' OR (lower(_phase) LIKE '%final%'
      AND lower(_phase) NOT LIKE '%semi%'
      AND lower(_phase) NOT LIKE '%third%'
      AND lower(_phase) NOT LIKE '%league%') THEN true
    ELSE false
  END;
$$;

-- ---------------------------------------------------------------------------
-- Cluster open window
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.match_cluster_open_window(
  _phase TEXT DEFAULT NULL,
  _leg_kind TEXT DEFAULT NULL
)
RETURNS interval
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN _leg_kind IN ('single', 'first', 'second', 'replay', 'final_single')
      THEN interval '210 minutes'
    WHEN private.is_knockout_bracket_phase(_phase)
      THEN interval '210 minutes'
    ELSE interval '150 minutes'
  END;
$$;

DROP FUNCTION IF EXISTS private.match_is_cluster_open(public.match_status, timestamptz);
DROP FUNCTION IF EXISTS private.match_is_cluster_open(public.match_status, timestamptz, timestamptz);

CREATE OR REPLACE FUNCTION private.match_is_cluster_open(
  _status public.match_status,
  _kickoff TIMESTAMPTZ,
  _now TIMESTAMPTZ DEFAULT now(),
  _phase TEXT DEFAULT NULL,
  _leg_kind TEXT DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN _status = 'finished' THEN false
    WHEN _kickoff + private.match_cluster_open_window(_phase, _leg_kind) <= _now THEN false
    WHEN _status IN ('scheduled', 'live') THEN true
    ELSE false
  END;
$$;

-- ---------------------------------------------------------------------------
-- Rebuild / refresh / active session: pass phase + leg_kind
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.rebuild_matchday_sessions(p_azores_date DATE)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  v_cluster INT := -1;
  v_last_ko TIMESTAMPTZ;
  v_ids UUID[] := '{}';
  v_first TIMESTAMPTZ;
  v_last TIMESTAMPTZ;
  v_count INT := 0;
  v_lookahead_end TIMESTAMPTZ;
  v_day_start TIMESTAMPTZ;
BEGIN
  SELECT day_start INTO v_day_start FROM private.azores_day_bounds(p_azores_date);
  v_lookahead_end := v_day_start + interval '36 hours';

  DELETE FROM public.sync_matchday_sessions
  WHERE azores_date = p_azores_date
    AND status IN ('planned', 'active');

  FOR r IN
    SELECT m.id, m.kickoff_at, m.status,
           (m.kickoff_at AT TIME ZONE 'Atlantic/Azores')::date AS az_date
    FROM public.matches m
    JOIN public.competitions c ON c.id = m.competition_id
    WHERE c.is_active = true
      AND m.kickoff_at >= v_day_start
      AND m.kickoff_at < v_lookahead_end
      AND m.status IN ('scheduled', 'live', 'finished')
    ORDER BY m.kickoff_at ASC, m.id ASC
  LOOP
    IF v_cluster < 0 THEN
      IF r.az_date <> p_azores_date THEN
        CONTINUE;
      END IF;
      v_cluster := 0;
      v_ids := ARRAY[r.id];
      v_first := r.kickoff_at;
      v_last := r.kickoff_at;
      v_last_ko := r.kickoff_at;
    ELSIF r.kickoff_at - v_last_ko <= interval '2 hours' THEN
      v_ids := v_ids || r.id;
      v_last := r.kickoff_at;
      v_last_ko := r.kickoff_at;
    ELSE
      INSERT INTO public.sync_matchday_sessions (
        azores_date, cluster_index, poll_start, poll_end,
        first_kickoff, last_kickoff, match_ids, status, updated_at
      ) VALUES (
        p_azores_date, v_cluster, v_first - interval '20 minutes', NULL,
        v_first, v_last, v_ids,
        CASE WHEN EXISTS (
          SELECT 1 FROM public.matches m2
          WHERE m2.id = ANY (v_ids)
            AND private.match_is_cluster_open(
              m2.status, m2.kickoff_at, now(), m2.phase, m2.leg_kind
            )
        ) THEN 'planned' ELSE 'done' END,
        now()
      )
      ON CONFLICT (azores_date, cluster_index) DO UPDATE SET
        poll_start = EXCLUDED.poll_start,
        first_kickoff = EXCLUDED.first_kickoff,
        last_kickoff = EXCLUDED.last_kickoff,
        match_ids = EXCLUDED.match_ids,
        status = EXCLUDED.status,
        poll_end = CASE WHEN EXCLUDED.status = 'done' THEN now() ELSE NULL END,
        updated_at = now();
      v_count := v_count + 1;

      IF r.az_date <> p_azores_date THEN
        v_cluster := -1;
        v_ids := '{}';
        CONTINUE;
      END IF;
      v_cluster := v_cluster + 1;
      v_ids := ARRAY[r.id];
      v_first := r.kickoff_at;
      v_last := r.kickoff_at;
      v_last_ko := r.kickoff_at;
    END IF;
  END LOOP;

  IF v_cluster >= 0 AND cardinality(v_ids) > 0 THEN
    INSERT INTO public.sync_matchday_sessions (
      azores_date, cluster_index, poll_start, poll_end,
      first_kickoff, last_kickoff, match_ids, status, updated_at
    ) VALUES (
      p_azores_date, v_cluster, v_first - interval '20 minutes', NULL,
      v_first, v_last, v_ids,
      CASE WHEN EXISTS (
        SELECT 1 FROM public.matches m2
        WHERE m2.id = ANY (v_ids)
          AND private.match_is_cluster_open(
            m2.status, m2.kickoff_at, now(), m2.phase, m2.leg_kind
          )
      ) THEN 'planned' ELSE 'done' END,
      now()
    )
    ON CONFLICT (azores_date, cluster_index) DO UPDATE SET
      poll_start = EXCLUDED.poll_start,
      first_kickoff = EXCLUDED.first_kickoff,
      last_kickoff = EXCLUDED.last_kickoff,
      match_ids = EXCLUDED.match_ids,
      status = EXCLUDED.status,
      poll_end = CASE WHEN EXCLUDED.status = 'done' THEN now() ELSE NULL END,
      updated_at = now();
    v_count := v_count + 1;
  END IF;

  UPDATE public.sync_matchday_sessions s
  SET status = 'done',
      poll_end = COALESCE(s.poll_end, now()),
      updated_at = now()
  WHERE s.azores_date = p_azores_date
    AND s.status <> 'done'
    AND NOT EXISTS (
      SELECT 1 FROM public.matches m
      WHERE m.id = ANY (s.match_ids)
        AND private.match_is_cluster_open(
          m.status, m.kickoff_at, now(), m.phase, m.leg_kind
        )
    );

  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION private.refresh_matchday_session_statuses(_now TIMESTAMPTZ DEFAULT now())
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.sync_matchday_sessions s
  SET status = 'active',
      updated_at = _now
  WHERE s.status IN ('planned', 'active')
    AND s.poll_start <= _now
    AND EXISTS (
      SELECT 1 FROM public.matches m
      WHERE m.id = ANY (s.match_ids)
        AND private.match_is_cluster_open(
          m.status, m.kickoff_at, _now, m.phase, m.leg_kind
        )
    );

  UPDATE public.sync_matchday_sessions s
  SET status = 'done',
      poll_end = COALESCE(s.poll_end, _now),
      updated_at = _now
  WHERE s.status IN ('planned', 'active')
    AND s.poll_start <= _now
    AND NOT EXISTS (
      SELECT 1 FROM public.matches m
      WHERE m.id = ANY (s.match_ids)
        AND private.match_is_cluster_open(
          m.status, m.kickoff_at, _now, m.phase, m.leg_kind
        )
    );
END;
$$;

CREATE OR REPLACE FUNCTION private.active_matchday_session(_now TIMESTAMPTZ DEFAULT now())
RETURNS public.sync_matchday_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session public.sync_matchday_sessions%ROWTYPE;
BEGIN
  SELECT * INTO v_session
  FROM public.sync_matchday_sessions s
  WHERE s.status = 'active'
     OR (
       s.status = 'planned'
       AND s.poll_start <= _now
       AND EXISTS (
         SELECT 1 FROM public.matches m
         WHERE m.id = ANY (s.match_ids)
           AND private.match_is_cluster_open(
             m.status, m.kickoff_at, _now, m.phase, m.leg_kind
           )
       )
     )
  ORDER BY s.poll_start ASC
  LIMIT 1;

  RETURN v_session;
END;
$$;

CREATE OR REPLACE FUNCTION private.should_dispatch_matchday(_now TIMESTAMPTZ DEFAULT now())
RETURNS TABLE (should_run BOOLEAN, reason TEXT, session_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session public.sync_matchday_sessions%ROWTYPE;
  v_last TIMESTAMPTZ;
BEGIN
  PERFORM private.refresh_matchday_session_statuses(_now);

  SELECT * INTO v_session
  FROM public.sync_matchday_sessions s
  WHERE s.status = 'active'
     OR (
       s.status = 'planned'
       AND s.poll_start <= _now
       AND EXISTS (
         SELECT 1 FROM public.matches m
         WHERE m.id = ANY (s.match_ids)
           AND private.match_is_cluster_open(
             m.status, m.kickoff_at, _now, m.phase, m.leg_kind
           )
       )
     )
  ORDER BY s.poll_start ASC
  LIMIT 1;

  IF NOT FOUND THEN
    should_run := false;
    reason := 'no_active_session';
    session_id := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT last_dispatch_at INTO v_last FROM public.sync_matchday_state WHERE id = 1;
  IF v_last IS NOT NULL AND v_last > _now - interval '5 minutes' THEN
    should_run := false;
    reason := 'cooldown_5m';
    session_id := v_session.id;
    RETURN NEXT;
    RETURN;
  END IF;

  should_run := true;
  reason := format('session_%s_cluster_%s', v_session.azores_date, v_session.cluster_index);
  session_id := v_session.id;
  RETURN NEXT;
END;
$$;

-- ---------------------------------------------------------------------------
-- Delta poll: 90' from score.fulltime (fallback goals); also ET + PEN
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.process_matchday_api_poll()
RETURNS TABLE (
  ready BOOLEAN,
  has_delta BOOLEAN,
  reason TEXT,
  session_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net
AS $$
DECLARE
  v_req_id BIGINT;
  v_session UUID;
  v_status INT;
  v_timed_out BOOLEAN;
  v_error TEXT;
  v_content TEXT;
  v_body JSONB;
  v_item JSONB;
  v_af_id TEXT;
  v_api_status TEXT;
  v_api_home INT;
  v_api_away INT;
  v_api_et_home INT;
  v_api_et_away INT;
  v_api_pen_home INT;
  v_api_pen_away INT;
  v_ft_home TEXT;
  v_ft_away TEXT;
  v_db public.matches%ROWTYPE;
  v_delta_reasons TEXT[] := '{}';
BEGIN
  SELECT pending_poll_request_id, pending_poll_session_id
  INTO v_req_id, v_session
  FROM public.sync_matchday_state
  WHERE id = 1;

  IF v_req_id IS NULL THEN
    ready := false;
    has_delta := false;
    reason := 'no_pending_poll';
    session_id := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT r.status_code, r.timed_out, r.error_msg, r.content
  INTO v_status, v_timed_out, v_error, v_content
  FROM net._http_response r
  WHERE r.id = v_req_id;

  IF NOT FOUND THEN
    ready := false;
    has_delta := false;
    reason := 'poll_pending';
    session_id := v_session;
    RETURN NEXT;
    RETURN;
  END IF;

  UPDATE public.sync_matchday_state
  SET pending_poll_request_id = NULL,
      pending_poll_session_id = NULL,
      updated_at = now()
  WHERE id = 1;

  IF COALESCE(v_timed_out, false) OR v_error IS NOT NULL OR v_status IS NULL OR v_status < 200 OR v_status >= 300 THEN
    ready := true;
    has_delta := false;
    reason := format('poll_api_error:status=%s:err=%s', coalesce(v_status::text, 'null'), coalesce(v_error, 'none'));
    session_id := v_session;
    INSERT INTO public.sync_matchday_dispatch_log (reason, session_id, http_request_id)
    VALUES (reason, v_session, v_req_id);
    UPDATE public.sync_matchday_state
    SET last_reason = reason, updated_at = now()
    WHERE id = 1;
    RETURN NEXT;
    RETURN;
  END IF;

  BEGIN
    v_body := v_content::jsonb;
  EXCEPTION WHEN OTHERS THEN
    ready := true;
    has_delta := false;
    reason := 'poll_api_error:invalid_json';
    session_id := v_session;
    INSERT INTO public.sync_matchday_dispatch_log (reason, session_id, http_request_id)
    VALUES (reason, v_session, v_req_id);
    UPDATE public.sync_matchday_state
    SET last_reason = reason, updated_at = now()
    WHERE id = 1;
    RETURN NEXT;
    RETURN;
  END;

  IF v_body -> 'response' IS NULL OR jsonb_typeof(v_body -> 'response') <> 'array' THEN
    ready := true;
    has_delta := false;
    reason := 'poll_api_error:no_response_array';
    session_id := v_session;
    INSERT INTO public.sync_matchday_dispatch_log (reason, session_id, http_request_id)
    VALUES (reason, v_session, v_req_id);
    UPDATE public.sync_matchday_state
    SET last_reason = reason, updated_at = now()
    WHERE id = 1;
    RETURN NEXT;
    RETURN;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_body -> 'response')
  LOOP
    v_af_id := 'af-' || (v_item #>> '{fixture,id}');
    v_api_status := private.map_api_football_status(v_item #>> '{fixture,status,short}');

    -- 90': prefer score.fulltime (aligned with Go sync); goals can include ET.
    v_ft_home := v_item #>> '{score,fulltime,home}';
    v_ft_away := v_item #>> '{score,fulltime,away}';
    IF v_ft_home IS NOT NULL AND v_ft_home <> '' THEN
      v_api_home := v_ft_home::INT;
    ELSIF (v_item -> 'goals' ->> 'home') IS NOT NULL AND (v_item -> 'goals' ->> 'home') <> '' THEN
      v_api_home := (v_item -> 'goals' ->> 'home')::INT;
    ELSE
      v_api_home := NULL;
    END IF;
    IF v_ft_away IS NOT NULL AND v_ft_away <> '' THEN
      v_api_away := v_ft_away::INT;
    ELSIF (v_item -> 'goals' ->> 'away') IS NOT NULL AND (v_item -> 'goals' ->> 'away') <> '' THEN
      v_api_away := (v_item -> 'goals' ->> 'away')::INT;
    ELSE
      v_api_away := NULL;
    END IF;

    IF (v_item #>> '{score,extratime,home}') IS NULL OR (v_item #>> '{score,extratime,home}') = '' THEN
      v_api_et_home := NULL;
    ELSE
      v_api_et_home := (v_item #>> '{score,extratime,home}')::INT;
    END IF;
    IF (v_item #>> '{score,extratime,away}') IS NULL OR (v_item #>> '{score,extratime,away}') = '' THEN
      v_api_et_away := NULL;
    ELSE
      v_api_et_away := (v_item #>> '{score,extratime,away}')::INT;
    END IF;

    IF (v_item #>> '{score,penalty,home}') IS NULL OR (v_item #>> '{score,penalty,home}') = '' THEN
      v_api_pen_home := NULL;
    ELSE
      v_api_pen_home := (v_item #>> '{score,penalty,home}')::INT;
    END IF;
    IF (v_item #>> '{score,penalty,away}') IS NULL OR (v_item #>> '{score,penalty,away}') = '' THEN
      v_api_pen_away := NULL;
    ELSE
      v_api_pen_away := (v_item #>> '{score,penalty,away}')::INT;
    END IF;

    SELECT * INTO v_db
    FROM public.matches m
    WHERE m.external_id = v_af_id
    LIMIT 1;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    IF v_db.status::text IS DISTINCT FROM v_api_status THEN
      v_delta_reasons := array_append(
        v_delta_reasons,
        format('%s:status:%s->%s', v_af_id, v_db.status::text, v_api_status)
      );
    END IF;
    IF v_db.home_score IS DISTINCT FROM v_api_home
       OR v_db.away_score IS DISTINCT FROM v_api_away THEN
      v_delta_reasons := array_append(
        v_delta_reasons,
        format(
          '%s:score90:%s-%s->%s-%s',
          v_af_id,
          coalesce(v_db.home_score::text, 'null'),
          coalesce(v_db.away_score::text, 'null'),
          coalesce(v_api_home::text, 'null'),
          coalesce(v_api_away::text, 'null')
        )
      );
    END IF;
    IF v_db.et_home_score IS DISTINCT FROM v_api_et_home
       OR v_db.et_away_score IS DISTINCT FROM v_api_et_away THEN
      v_delta_reasons := array_append(
        v_delta_reasons,
        format(
          '%s:scoreET:%s-%s->%s-%s',
          v_af_id,
          coalesce(v_db.et_home_score::text, 'null'),
          coalesce(v_db.et_away_score::text, 'null'),
          coalesce(v_api_et_home::text, 'null'),
          coalesce(v_api_et_away::text, 'null')
        )
      );
    END IF;
    IF v_db.pen_home_score IS DISTINCT FROM v_api_pen_home
       OR v_db.pen_away_score IS DISTINCT FROM v_api_pen_away THEN
      v_delta_reasons := array_append(
        v_delta_reasons,
        format(
          '%s:scorePEN:%s-%s->%s-%s',
          v_af_id,
          coalesce(v_db.pen_home_score::text, 'null'),
          coalesce(v_db.pen_away_score::text, 'null'),
          coalesce(v_api_pen_home::text, 'null'),
          coalesce(v_api_pen_away::text, 'null')
        )
      );
    END IF;
  END LOOP;

  ready := true;
  session_id := v_session;

  IF cardinality(v_delta_reasons) > 0 THEN
    has_delta := true;
    reason := 'delta:' || left(array_to_string(v_delta_reasons, ','), 400);
  ELSE
    has_delta := false;
    reason := 'poll_no_delta';
  END IF;

  UPDATE public.sync_matchday_state
  SET last_reason = reason, updated_at = now()
  WHERE id = 1;

  RETURN NEXT;
END;
$$;

-- ---------------------------------------------------------------------------
-- Support team defaults: UCL / EL → per_phase + 7
-- ---------------------------------------------------------------------------

UPDATE public.competitions
SET default_settings = coalesce(default_settings, '{}'::jsonb) || jsonb_build_object(
  'points_support_advance', 7,
  'support_team_mode', 'per_phase',
  'special_bet_support_team_enabled', true
)
WHERE slug IN (
  'champions-league-26-27',
  'europa-league-26-27'
);
