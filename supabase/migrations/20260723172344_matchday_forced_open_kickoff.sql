-- Forced matchday dispatches at cluster open (T-20) and first kickoff (T-0).
-- After that, delta poll continues as before.
-- Forced runs bypass the 90s GitHub anti-spam so T-0 is not skipped after T-20.

CREATE TABLE IF NOT EXISTS public.sync_matchday_forced (
  azores_date DATE NOT NULL,
  cluster_index INT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('open', 'kickoff')),
  session_id UUID,
  dispatched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (azores_date, cluster_index, kind)
);

COMMENT ON TABLE public.sync_matchday_forced IS
  'Idempotent record of mandatory matchday Actions (T-20 open + T-0 kickoff) per Azores cluster.';

REVOKE ALL ON TABLE public.sync_matchday_forced FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.sync_matchday_forced TO service_role;

ALTER TABLE public.sync_matchday_forced ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Dispatch with optional anti-spam bypass (for forced open / kickoff)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.dispatch_matchday_workflow(
  p_session_id UUID,
  p_reason TEXT,
  p_bypass_antispam BOOLEAN
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
  IF NOT COALESCE(p_bypass_antispam, false) THEN
    SELECT last_dispatch_at INTO v_last FROM public.sync_matchday_state WHERE id = 1;
    IF v_last IS NOT NULL AND v_last > now() - interval '90 seconds' THEN
      UPDATE public.sync_matchday_state
      SET last_reason = 'dispatch_antispam_90s',
          updated_at = now()
      WHERE id = 1;
      RETURN NULL;
    END IF;
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
      last_reason = left(v_reason, 200),
      updated_at = now()
  WHERE id = 1;

  INSERT INTO public.sync_matchday_dispatch_log (reason, session_id, http_request_id)
  VALUES (left(v_reason, 200), p_session_id, v_req_id);

  RETURN v_req_id;
END;
$$;

-- 2-arg overload (delta path): always respects 90s anti-spam
CREATE OR REPLACE FUNCTION private.dispatch_matchday_workflow(
  p_session_id UUID,
  p_reason TEXT
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN private.dispatch_matchday_workflow(p_session_id, p_reason, false);
END;
$$;

-- ---------------------------------------------------------------------------
-- Maybe fire forced open (poll_start / T-20) and forced kickoff (first_kickoff)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.maybe_force_matchday_dispatches(_now TIMESTAMPTZ DEFAULT now())
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session public.sync_matchday_sessions%ROWTYPE;
  v_req BIGINT;
BEGIN
  v_session := private.active_matchday_session(_now);
  IF v_session.id IS NULL THEN
    RETURN;
  END IF;

  -- T-20 / cluster open (poll_start)
  IF v_session.poll_start <= _now
     AND NOT EXISTS (
       SELECT 1 FROM public.sync_matchday_forced f
       WHERE f.azores_date = v_session.azores_date
         AND f.cluster_index = v_session.cluster_index
         AND f.kind = 'open'
     )
  THEN
    v_req := private.dispatch_matchday_workflow(
      v_session.id,
      format('forced_open_t20:%s_c%s', v_session.azores_date, v_session.cluster_index),
      true
    );
    IF v_req IS NOT NULL THEN
      INSERT INTO public.sync_matchday_forced (azores_date, cluster_index, kind, session_id)
      VALUES (v_session.azores_date, v_session.cluster_index, 'open', v_session.id)
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  -- Re-read active session (still same cluster typically)
  v_session := private.active_matchday_session(_now);
  IF v_session.id IS NULL THEN
    RETURN;
  END IF;

  -- T-0 / first kickoff of cluster
  IF v_session.first_kickoff <= _now
     AND NOT EXISTS (
       SELECT 1 FROM public.sync_matchday_forced f
       WHERE f.azores_date = v_session.azores_date
         AND f.cluster_index = v_session.cluster_index
         AND f.kind = 'kickoff'
     )
  THEN
    v_req := private.dispatch_matchday_workflow(
      v_session.id,
      format('forced_kickoff:%s_c%s', v_session.azores_date, v_session.cluster_index),
      true
    );
    IF v_req IS NOT NULL THEN
      INSERT INTO public.sync_matchday_forced (azores_date, cluster_index, kind, session_id)
      VALUES (v_session.azores_date, v_session.cluster_index, 'kickoff', v_session.id)
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION private.maybe_force_matchday_dispatches(TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.maybe_force_matchday_dispatches(TIMESTAMPTZ) TO service_role;

-- ---------------------------------------------------------------------------
-- Tick: refresh → forced open/kickoff → process poll delta → next poll
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

  -- Mandatory Actions at T-20 and T-0 (idempotent via sync_matchday_forced)
  PERFORM private.maybe_force_matchday_dispatches(now());

  SELECT p.ready, p.has_delta, p.reason, p.session_id
  INTO v_ready, v_has_delta, v_reason, v_session_id
  FROM private.process_matchday_api_poll() p
  LIMIT 1;

  IF COALESCE(v_ready, false) AND COALESCE(v_has_delta, false) AND v_session_id IS NOT NULL THEN
    PERFORM private.dispatch_matchday_workflow(v_session_id, v_reason, false);
  END IF;

  SELECT pending_poll_request_id INTO v_pending
  FROM public.sync_matchday_state
  WHERE id = 1;

  IF v_pending IS NOT NULL THEN
    RETURN;
  END IF;

  v_session := private.active_matchday_session(now());
  IF v_session.id IS NULL THEN
    RETURN;
  END IF;

  PERFORM private.request_matchday_api_poll(v_session.id);
END;
$$;
