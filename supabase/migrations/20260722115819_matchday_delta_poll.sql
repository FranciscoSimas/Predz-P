-- Matchday delta poll: ask API-Football while a cluster is active; GitHub
-- workflow_dispatch only when status or scores differ from DB.
-- Requires Vault secrets: api_football_key, github_actions_dispatch_pat

-- ---------------------------------------------------------------------------
-- State: pending async pg_net poll
-- ---------------------------------------------------------------------------

ALTER TABLE public.sync_matchday_state
  ADD COLUMN IF NOT EXISTS pending_poll_request_id BIGINT,
  ADD COLUMN IF NOT EXISTS pending_poll_session_id UUID
    REFERENCES public.sync_matchday_sessions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_poll_at TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- Map API-Football status.short → public match_status (aligned with Go mapFDStatus)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.map_api_football_status(short TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE upper(coalesce(short, ''))
    WHEN 'IN_PLAY' THEN 'live'
    WHEN 'PAUSED' THEN 'live'
    WHEN 'EXTRA_TIME' THEN 'live'
    WHEN 'PENALTY_SHOOTOUT' THEN 'live'
    WHEN 'LIVE' THEN 'live'
    WHEN '1H' THEN 'live'
    WHEN '2H' THEN 'live'
    WHEN 'HT' THEN 'live'
    WHEN 'ET' THEN 'live'
    WHEN 'BT' THEN 'live'
    WHEN 'P' THEN 'live'
    WHEN 'INT' THEN 'live'
    WHEN 'FINISHED' THEN 'finished'
    WHEN 'AWARDED' THEN 'finished'
    WHEN 'FT' THEN 'finished'
    WHEN 'AET' THEN 'finished'
    WHEN 'PEN' THEN 'finished'
    ELSE 'scheduled'
  END;
$$;

-- ---------------------------------------------------------------------------
-- Active / eligible session (same rules as former should_dispatch body)
-- ---------------------------------------------------------------------------

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
           AND private.match_is_cluster_open(m.status, m.kickoff_at, _now)
       )
     )
  ORDER BY s.poll_start ASC
  LIMIT 1;

  RETURN v_session;
END;
$$;

-- ---------------------------------------------------------------------------
-- Fire async API-Football fixtures poll for a session
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.request_matchday_api_poll(p_session_id UUID)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, net
AS $$
DECLARE
  v_key TEXT;
  v_ids TEXT;
  v_url TEXT;
  v_req_id BIGINT;
BEGIN
  SELECT ds.decrypted_secret INTO v_key
  FROM vault.decrypted_secrets ds
  WHERE ds.name = 'api_football_key'
  LIMIT 1;

  IF v_key IS NULL OR length(trim(v_key)) < 8 THEN
    INSERT INTO public.sync_matchday_dispatch_log (reason, session_id)
    VALUES ('missing_vault_secret:api_football_key', p_session_id);
    UPDATE public.sync_matchday_state
    SET last_reason = 'missing_vault_secret:api_football_key',
        updated_at = now()
    WHERE id = 1;
    RETURN NULL;
  END IF;

  SELECT string_agg(replace(m.external_id, 'af-', ''), '-' ORDER BY m.kickoff_at, m.id)
  INTO v_ids
  FROM public.sync_matchday_sessions s
  JOIN public.matches m ON m.id = ANY (s.match_ids)
  WHERE s.id = p_session_id
    AND m.external_id LIKE 'af-%'
    AND replace(m.external_id, 'af-', '') ~ '^[0-9]+$';

  IF v_ids IS NULL OR v_ids = '' THEN
    UPDATE public.sync_matchday_state
    SET last_reason = 'poll_no_af_fixture_ids',
        updated_at = now()
    WHERE id = 1;
    RETURN NULL;
  END IF;

  v_url := 'https://v3.football.api-sports.io/fixtures?ids=' || v_ids;

  SELECT net.http_get(
    url := v_url,
    headers := jsonb_build_object(
      'x-apisports-key', v_key
    ),
    timeout_milliseconds := 8000
  ) INTO v_req_id;

  UPDATE public.sync_matchday_state
  SET pending_poll_request_id = v_req_id,
      pending_poll_session_id = p_session_id,
      last_poll_at = now(),
      last_reason = 'poll_requested',
      updated_at = now()
  WHERE id = 1;

  RETURN v_req_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Process pending poll response; detect status/score delta (ignore live_minute)
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
    -- Still in flight
    ready := false;
    has_delta := false;
    reason := 'poll_pending';
    session_id := v_session;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Clear pending before interpreting (avoid stuck request id)
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

    IF (v_item -> 'goals' ->> 'home') IS NULL OR (v_item -> 'goals' ->> 'home') = '' THEN
      v_api_home := NULL;
    ELSE
      v_api_home := (v_item -> 'goals' ->> 'home')::INT;
    END IF;
    IF (v_item -> 'goals' ->> 'away') IS NULL OR (v_item -> 'goals' ->> 'away') = '' THEN
      v_api_away := NULL;
    ELSE
      v_api_away := (v_item -> 'goals' ->> 'away')::INT;
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
          '%s:score:%s-%s->%s-%s',
          v_af_id,
          coalesce(v_db.home_score::text, 'null'),
          coalesce(v_db.away_score::text, 'null'),
          coalesce(v_api_home::text, 'null'),
          coalesce(v_api_away::text, 'null')
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
-- should_dispatch: retained for debugging; no longer drives blind 5m polls
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.should_dispatch_matchday(_now TIMESTAMPTZ DEFAULT now())
RETURNS TABLE (should_run BOOLEAN, reason TEXT, session_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session public.sync_matchday_sessions%ROWTYPE;
BEGIN
  PERFORM private.refresh_matchday_session_statuses(_now);
  v_session := private.active_matchday_session(_now);

  IF v_session.id IS NULL THEN
    should_run := false;
    reason := 'no_active_session';
    session_id := NULL;
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
-- Dispatch GitHub when caller already detected a delta
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.dispatch_matchday_workflow(
  p_session_id UUID,
  p_reason TEXT
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, net
AS $$
DECLARE
  v_pat TEXT;
  v_req_id BIGINT;
  v_owner TEXT := 'FranciscoSimas';
  v_repo TEXT := 'Fantasy-Futebol';
  v_workflow TEXT := 'sync-matchday.yml';
  v_url TEXT;
  v_last TIMESTAMPTZ;
  v_reason TEXT := coalesce(nullif(trim(p_reason), ''), 'delta');
BEGIN
  SELECT last_dispatch_at INTO v_last FROM public.sync_matchday_state WHERE id = 1;
  IF v_last IS NOT NULL AND v_last > now() - interval '90 seconds' THEN
    UPDATE public.sync_matchday_state
    SET last_reason = 'dispatch_antispam_90s',
        updated_at = now()
    WHERE id = 1;
    RETURN NULL;
  END IF;

  SELECT ds.decrypted_secret INTO v_pat
  FROM vault.decrypted_secrets ds
  WHERE ds.name = 'github_actions_dispatch_pat'
  LIMIT 1;

  IF v_pat IS NULL OR length(trim(v_pat)) < 10 THEN
    INSERT INTO public.sync_matchday_dispatch_log (reason, session_id)
    VALUES ('missing_vault_secret:github_actions_dispatch_pat', p_session_id);
    RAISE WARNING 'matchday dispatch skipped: Vault secret github_actions_dispatch_pat not set';
    RETURN NULL;
  END IF;

  v_url := format(
    'https://api.github.com/repos/%s/%s/actions/workflows/%s/dispatches',
    v_owner, v_repo, v_workflow
  );

  SELECT net.http_post(
    url := v_url,
    body := jsonb_build_object(
      'ref', 'main',
      'inputs', jsonb_build_object('operation', 'import')
    ),
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_pat,
      'Accept', 'application/vnd.github+json',
      'X-GitHub-Api-Version', '2022-11-28',
      'Content-Type', 'application/json'
    )
  ) INTO v_req_id;

  UPDATE public.sync_matchday_state
  SET last_dispatch_at = now(),
      last_reason = v_reason,
      updated_at = now()
  WHERE id = 1;

  INSERT INTO public.sync_matchday_dispatch_log (reason, session_id, http_request_id)
  VALUES (v_reason, p_session_id, v_req_id);

  RETURN v_req_id;
END;
$$;

-- Back-compat wrapper (no-arg): only used if something still calls old signature
CREATE OR REPLACE FUNCTION private.dispatch_matchday_workflow()
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Blind dispatch disabled; delta tick owns GitHub calls.
  RETURN NULL;
END;
$$;

-- ---------------------------------------------------------------------------
-- Tick: refresh → process poll → maybe dispatch → request next poll
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.tick_matchday_orchestrator()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ready BOOLEAN;
  v_has_delta BOOLEAN;
  v_reason TEXT;
  v_session_id UUID;
  v_session public.sync_matchday_sessions%ROWTYPE;
  v_pending BIGINT;
BEGIN
  PERFORM private.refresh_matchday_session_statuses(now());

  SELECT p.ready, p.has_delta, p.reason, p.session_id
  INTO v_ready, v_has_delta, v_reason, v_session_id
  FROM private.process_matchday_api_poll() p
  LIMIT 1;

  IF COALESCE(v_ready, false) AND COALESCE(v_has_delta, false) AND v_session_id IS NOT NULL THEN
    PERFORM private.dispatch_matchday_workflow(v_session_id, v_reason);
  END IF;

  SELECT pending_poll_request_id INTO v_pending
  FROM public.sync_matchday_state
  WHERE id = 1;

  IF v_pending IS NOT NULL THEN
    -- Still waiting for in-flight poll
    RETURN;
  END IF;

  v_session := private.active_matchday_session(now());
  IF v_session.id IS NULL THEN
    RETURN;
  END IF;

  PERFORM private.request_matchday_api_poll(v_session.id);
END;
$$;
