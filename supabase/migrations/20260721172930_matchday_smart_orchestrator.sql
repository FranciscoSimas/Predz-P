-- Matchday smart orchestrator: sessions (Azores clusters) + pg_cron dispatch to GitHub Actions
-- Requires GitHub PAT in Vault (name: github_actions_dispatch_pat) — see sync/README.md

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

-- Grant cron usage (Supabase pattern)
GRANT USAGE ON SCHEMA cron TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA cron TO postgres;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.sync_matchday_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  azores_date DATE NOT NULL,
  cluster_index INT NOT NULL,
  poll_start TIMESTAMPTZ NOT NULL,
  poll_end TIMESTAMPTZ,
  first_kickoff TIMESTAMPTZ NOT NULL,
  last_kickoff TIMESTAMPTZ NOT NULL,
  match_ids UUID[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'active', 'done')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (azores_date, cluster_index)
);

CREATE INDEX IF NOT EXISTS idx_sync_matchday_sessions_poll
  ON public.sync_matchday_sessions (poll_start, status);

CREATE TABLE IF NOT EXISTS public.sync_matchday_dispatch_log (
  id BIGSERIAL PRIMARY KEY,
  dispatched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason TEXT NOT NULL,
  session_id UUID REFERENCES public.sync_matchday_sessions(id) ON DELETE SET NULL,
  http_request_id BIGINT
);

CREATE TABLE IF NOT EXISTS public.sync_matchday_state (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_dispatch_at TIMESTAMPTZ,
  last_reason TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.sync_matchday_state (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.sync_matchday_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_matchday_dispatch_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_matchday_state ENABLE ROW LEVEL SECURITY;

-- service_role bypasses RLS; no policies for authenticated (internal only)
REVOKE ALL ON public.sync_matchday_sessions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.sync_matchday_dispatch_log FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.sync_matchday_state FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.sync_matchday_sessions TO service_role;
GRANT ALL ON public.sync_matchday_dispatch_log TO service_role;
GRANT ALL ON public.sync_matchday_state TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.sync_matchday_dispatch_log_id_seq TO service_role;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.azores_day_bounds(p_date DATE)
RETURNS TABLE (day_start TIMESTAMPTZ, day_end TIMESTAMPTZ)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    (p_date::timestamp AT TIME ZONE 'Atlantic/Azores') AS day_start,
    ((p_date + 1)::timestamp AT TIME ZONE 'Atlantic/Azores') AS day_end;
$$;

CREATE OR REPLACE FUNCTION private.match_is_cluster_open(
  _status public.match_status,
  _kickoff TIMESTAMPTZ,
  _now TIMESTAMPTZ DEFAULT now()
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN _status = 'finished' THEN false
    WHEN _kickoff + interval '150 minutes' <= _now THEN false
    WHEN _status IN ('scheduled', 'live') THEN true
    ELSE false
  END;
$$;

-- ---------------------------------------------------------------------------
-- Rebuild sessions for an Azores calendar date
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
  -- Look ahead 36h so post-midnight games can join today's last cluster
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
    -- Skip matches that belong to a later calendar day until we have an open cluster from p_azores_date
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
      -- Close previous cluster (only if it started on p_azores_date — always true here)
      INSERT INTO public.sync_matchday_sessions (
        azores_date, cluster_index, poll_start, poll_end,
        first_kickoff, last_kickoff, match_ids, status, updated_at
      ) VALUES (
        p_azores_date, v_cluster, v_first - interval '20 minutes', NULL,
        v_first, v_last, v_ids,
        CASE WHEN EXISTS (
          SELECT 1 FROM public.matches m2
          WHERE m2.id = ANY (v_ids)
            AND private.match_is_cluster_open(m2.status, m2.kickoff_at)
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

      -- Start new cluster only if this match is still on p_azores_date
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
          AND private.match_is_cluster_open(m2.status, m2.kickoff_at)
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

  -- Mark fully finished sessions as done
  UPDATE public.sync_matchday_sessions s
  SET status = 'done',
      poll_end = COALESCE(s.poll_end, now()),
      updated_at = now()
  WHERE s.azores_date = p_azores_date
    AND s.status <> 'done'
    AND NOT EXISTS (
      SELECT 1 FROM public.matches m
      WHERE m.id = ANY (s.match_ids)
        AND private.match_is_cluster_open(m.status, m.kickoff_at)
    );

  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.rebuild_matchday_sessions(p_azores_date DATE DEFAULT NULL)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d DATE;
  n INT;
  n2 INT;
BEGIN
  d := COALESCE(
    p_azores_date,
    (now() AT TIME ZONE 'Atlantic/Azores')::date
  );
  n := private.rebuild_matchday_sessions(d);
  -- Also rebuild tomorrow so early overnight clusters are ready
  n2 := private.rebuild_matchday_sessions(d + 1);
  RETURN n + n2;
END;
$$;

REVOKE ALL ON FUNCTION public.rebuild_matchday_sessions(DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rebuild_matchday_sessions(DATE) TO service_role;

-- ---------------------------------------------------------------------------
-- Refresh session active/done from live match state
-- ---------------------------------------------------------------------------

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
        AND private.match_is_cluster_open(m.status, m.kickoff_at, _now)
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
        AND private.match_is_cluster_open(m.status, m.kickoff_at, _now)
    );
END;
$$;

-- ---------------------------------------------------------------------------
-- Should dispatch?
-- ---------------------------------------------------------------------------

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
           AND private.match_is_cluster_open(m.status, m.kickoff_at, _now)
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
-- Dispatch GitHub workflow via pg_net + Vault PAT
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.dispatch_matchday_workflow()
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, net
AS $$
DECLARE
  v_should BOOLEAN;
  v_reason TEXT;
  v_session UUID;
  v_pat TEXT;
  v_req_id BIGINT;
  v_owner TEXT := 'FranciscoSimas';
  v_repo TEXT := 'Fantasy-Futebol';
  v_workflow TEXT := 'sync-matchday.yml';
  v_url TEXT;
BEGIN
  SELECT s.should_run, s.reason, s.session_id
  INTO v_should, v_reason, v_session
  FROM private.should_dispatch_matchday() s
  LIMIT 1;

  IF NOT COALESCE(v_should, false) THEN
    RETURN NULL;
  END IF;

  SELECT ds.decrypted_secret INTO v_pat
  FROM vault.decrypted_secrets ds
  WHERE ds.name = 'github_actions_dispatch_pat'
  LIMIT 1;

  IF v_pat IS NULL OR length(trim(v_pat)) < 10 THEN
    INSERT INTO public.sync_matchday_dispatch_log (reason, session_id)
    VALUES ('missing_vault_secret:github_actions_dispatch_pat', v_session);
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
  VALUES (v_reason, v_session, v_req_id);

  RETURN v_req_id;
END;
$$;

CREATE OR REPLACE FUNCTION private.tick_matchday_orchestrator()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM private.dispatch_matchday_workflow();
END;
$$;

-- Schedule every minute (idempotent replace)
DO $$
DECLARE
  jid INT;
BEGIN
  SELECT jobid INTO jid FROM cron.job WHERE jobname = 'matchday-orchestrator';
  IF jid IS NOT NULL THEN
    PERFORM cron.unschedule(jid);
  END IF;
  PERFORM cron.schedule(
    'matchday-orchestrator',
    '* * * * *',
    $cron$SELECT private.tick_matchday_orchestrator();$cron$
  );
END $$;

-- Initial rebuild for today/tomorrow (safe if no matches)
SELECT public.rebuild_matchday_sessions(NULL);
