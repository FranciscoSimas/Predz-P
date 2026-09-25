-- =============================================================================
-- Member withdraw ("Desistir") for private tournaments
-- Keeps membership + points; blocks further predictions; visible in ranking
-- =============================================================================

ALTER TABLE public.tournament_members
  ADD COLUMN IF NOT EXISTS withdrawn_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.tournament_members.withdrawn_at IS
  'When set, member gave up: keeps points/ranking but cannot submit predictions.';

CREATE INDEX IF NOT EXISTS idx_tm_active
  ON public.tournament_members (tournament_id)
  WHERE withdrawn_at IS NULL;

-- Active (= not withdrawn) membership helper
CREATE OR REPLACE FUNCTION private.is_active_tournament_member(_tournament_id UUID)
RETURNS BOOLEAN
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
  );
$$;

REVOKE ALL ON FUNCTION private.is_active_tournament_member(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_active_tournament_member(UUID)
  TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- withdraw_from_tournament RPC (private tournaments only; not owner)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.withdraw_from_tournament(_tournament_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_is_public boolean;
  v_is_official boolean;
  v_updated int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF _tournament_id IS NULL THEN
    RAISE EXCEPTION 'tournament_id is required';
  END IF;

  SELECT t.owner_id, t.is_public, t.is_official
    INTO v_owner, v_is_public, v_is_official
  FROM public.tournaments t
  WHERE t.id = _tournament_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'tournament not found';
  END IF;

  IF v_is_public OR v_is_official THEN
    RAISE EXCEPTION 'withdraw is only allowed in private tournaments';
  END IF;

  IF v_owner = v_uid THEN
    RAISE EXCEPTION 'owner cannot withdraw from their tournament';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.tournament_members tm
    WHERE tm.tournament_id = _tournament_id AND tm.user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'not a member of this tournament';
  END IF;

  UPDATE public.tournament_members
  SET withdrawn_at = now()
  WHERE tournament_id = _tournament_id
    AND user_id = v_uid
    AND withdrawn_at IS NULL;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  -- Already withdrawn → idempotent success
  IF v_updated = 0 THEN
    RETURN;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.withdraw_from_tournament(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.withdraw_from_tournament(UUID) TO authenticated;

COMMENT ON FUNCTION public.withdraw_from_tournament(UUID) IS
  'Private tournaments only: mark caller as withdrawn (keeps points, blocks new predictions).';

-- -----------------------------------------------------------------------------
-- Leaderboard: expose withdrawn_at
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS public.tournament_leaderboard;
DROP FUNCTION IF EXISTS public.get_tournament_leaderboard(UUID);
DROP FUNCTION IF EXISTS private.current_user_leaderboard();

CREATE OR REPLACE FUNCTION private.current_user_leaderboard()
RETURNS TABLE(
  tournament_id uuid, user_id uuid, display_name text, avatar_url text,
  total_points integer, correct_count integer, exact_count integer, predictions_made integer,
  special_bets_points integer, streak_bonus_points integer,
  current_streak integer, best_streak integer, wildcards_used integer,
  withdrawn_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
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
    )::INT,
    COALESCE(tm.correct_count, 0)::INT,
    COALESCE(tm.exact_count, 0)::INT,
    COALESCE(tm.predictions_made, 0)::INT,
    COALESCE(tm.special_bets_points, 0)::INT,
    COALESCE(st.bonus_points, 0)::INT,
    COALESCE(st.current_streak, 0)::INT,
    COALESCE(st.best_streak, 0)::INT,
    COALESCE(tm.wildcards_used, 0)::INT,
    tm.withdrawn_at
  FROM public.tournament_members tm
  LEFT JOIN public.profiles pr ON pr.id = tm.user_id
  LEFT JOIN public.tournament_member_streaks st
    ON st.tournament_id = tm.tournament_id AND st.user_id = tm.user_id
  WHERE private.is_tournament_member(tm.tournament_id);
$$;

CREATE OR REPLACE FUNCTION public.get_tournament_leaderboard(_tournament_id UUID)
RETURNS TABLE(
  tournament_id uuid, user_id uuid, display_name text, avatar_url text,
  total_points integer, correct_count integer, exact_count integer, predictions_made integer,
  special_bets_points integer, streak_bonus_points integer,
  current_streak integer, best_streak integer, wildcards_used integer,
  withdrawn_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
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
    )::INT,
    COALESCE(tm.correct_count, 0)::INT,
    COALESCE(tm.exact_count, 0)::INT,
    COALESCE(tm.predictions_made, 0)::INT,
    COALESCE(tm.special_bets_points, 0)::INT,
    COALESCE(st.bonus_points, 0)::INT,
    COALESCE(st.current_streak, 0)::INT,
    COALESCE(st.best_streak, 0)::INT,
    COALESCE(tm.wildcards_used, 0)::INT,
    tm.withdrawn_at
  FROM public.tournament_members tm
  LEFT JOIN public.profiles pr ON pr.id = tm.user_id
  LEFT JOIN public.tournament_member_streaks st
    ON st.tournament_id = tm.tournament_id AND st.user_id = tm.user_id
  WHERE tm.tournament_id = _tournament_id
    AND private.is_tournament_member(_tournament_id);
$$;

CREATE VIEW public.tournament_leaderboard
WITH (security_invoker = true)
AS SELECT * FROM private.current_user_leaderboard();

GRANT SELECT ON public.tournament_leaderboard TO authenticated;
REVOKE ALL ON FUNCTION private.current_user_leaderboard() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.current_user_leaderboard() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_tournament_leaderboard(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_tournament_leaderboard(UUID) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Block special bets writes when withdrawn
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "special_bets insert own" ON public.special_bets;
CREATE POLICY "special_bets insert own"
  ON public.special_bets FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND private.is_active_tournament_member(tournament_id)
    AND EXISTS (
      SELECT 1 FROM public.tournament_settings ts
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
    AND private.is_active_tournament_member(tournament_id)
  )
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND private.is_active_tournament_member(tournament_id)
    AND EXISTS (
      SELECT 1 FROM public.tournament_settings ts
      WHERE ts.tournament_id = special_bets.tournament_id
        AND (ts.special_bets_cutoff_at IS NULL OR ts.special_bets_cutoff_at > now())
    )
  );

DROP POLICY IF EXISTS "special_bets delete own" ON public.special_bets;
CREATE POLICY "special_bets delete own"
  ON public.special_bets FOR DELETE TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND private.is_active_tournament_member(tournament_id)
    AND EXISTS (
      SELECT 1 FROM public.tournament_settings ts
      WHERE ts.tournament_id = special_bets.tournament_id
        AND (ts.special_bets_cutoff_at IS NULL OR ts.special_bets_cutoff_at > now())
    )
  );

-- -----------------------------------------------------------------------------
-- Shared match prediction: skip withdrawn tournaments; block target if withdrawn
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_shared_match_prediction(
  _match_id uuid,
  _home_pred int,
  _away_pred int,
  _et_home_pred int DEFAULT NULL,
  _et_away_pred int DEFAULT NULL,
  _pen_home_pred int DEFAULT NULL,
  _pen_away_pred int DEFAULT NULL,
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
  v_pick_id uuid;
  v_tid uuid;
  v_synced int := 0;
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

  SELECT m.competition_id, m.kickoff_at
    INTO v_comp, v_kickoff
  FROM public.matches m
  WHERE m.id = _match_id;

  IF v_comp IS NULL THEN
    RAISE EXCEPTION 'match not found';
  END IF;
  IF v_kickoff <= now() THEN
    RAISE EXCEPTION 'match already started';
  END IF;

  IF _tournament_id IS NOT NULL THEN
    IF NOT private.is_tournament_member(_tournament_id) THEN
      RAISE EXCEPTION 'not a member of this tournament';
    END IF;
    IF NOT private.is_active_tournament_member(_tournament_id) THEN
      RAISE EXCEPTION 'withdrawn from this tournament';
    END IF;
  END IF;

  -- Must be an active member of at least one tournament for this competition
  IF NOT EXISTS (
    SELECT 1
    FROM public.tournaments t
    JOIN public.tournament_members tm
      ON tm.tournament_id = t.id AND tm.user_id = v_uid
    WHERE t.competition_id = v_comp
      AND tm.withdrawn_at IS NULL
  ) THEN
    RAISE EXCEPTION 'not an active member of any tournament for this competition';
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
      ON tm.tournament_id = t.id AND tm.user_id = v_uid
    WHERE t.competition_id = v_comp
      AND tm.withdrawn_at IS NULL
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

REVOKE ALL ON FUNCTION public.upsert_shared_match_prediction(
  uuid, int, int, int, int, int, int, boolean, uuid
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_shared_match_prediction(
  uuid, int, int, int, int, int, int, boolean, uuid
) TO authenticated;

CREATE OR REPLACE FUNCTION public.upsert_shared_match_predictions_batch(
  _tournament_id uuid,
  _items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_item jsonb;
  v_match_id uuid;
  v_home int;
  v_away int;
  v_et_home int;
  v_et_away int;
  v_pen_home int;
  v_pen_away int;
  v_wildcard boolean;
  v_result jsonb;
  v_saved int := 0;
  v_max_synced int := 0;
  v_synced int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF _tournament_id IS NULL THEN
    RAISE EXCEPTION 'tournament_id is required';
  END IF;

  IF _items IS NULL OR jsonb_typeof(_items) <> 'array' OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'items must be a non-empty JSON array';
  END IF;

  IF NOT private.is_tournament_member(_tournament_id) THEN
    RAISE EXCEPTION 'not a member of this tournament';
  END IF;

  IF NOT private.is_active_tournament_member(_tournament_id) THEN
    RAISE EXCEPTION 'withdrawn from this tournament';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(_items)
  LOOP
    v_match_id := NULLIF(v_item->>'match_id', '')::uuid;
    v_home := NULLIF(v_item->>'home_pred', '')::int;
    v_away := NULLIF(v_item->>'away_pred', '')::int;
    v_et_home := NULLIF(v_item->>'et_home_pred', '')::int;
    v_et_away := NULLIF(v_item->>'et_away_pred', '')::int;
    v_pen_home := NULLIF(v_item->>'pen_home_pred', '')::int;
    v_pen_away := NULLIF(v_item->>'pen_away_pred', '')::int;
    v_wildcard := COALESCE((v_item->>'is_wildcard')::boolean, false);

    IF v_match_id IS NULL OR v_home IS NULL OR v_away IS NULL THEN
      RAISE EXCEPTION 'each item requires match_id, home_pred, away_pred';
    END IF;

    v_result := public.upsert_shared_match_prediction(
      v_match_id,
      v_home,
      v_away,
      v_et_home,
      v_et_away,
      v_pen_home,
      v_pen_away,
      v_wildcard,
      _tournament_id
    );

    v_saved := v_saved + 1;
    v_synced := COALESCE((v_result->>'synced_tournaments')::int, 1);
    IF v_synced > v_max_synced THEN
      v_max_synced := v_synced;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'saved', v_saved,
    'synced_tournaments', v_max_synced,
    'tournament_id', _tournament_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_shared_match_predictions_batch(uuid, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_shared_match_predictions_batch(uuid, jsonb)
  TO authenticated;
