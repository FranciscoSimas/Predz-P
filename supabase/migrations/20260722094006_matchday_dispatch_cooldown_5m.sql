-- Matchday orchestrator: raise active dispatch cooldown 3m → 5m (Actions budget)
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
