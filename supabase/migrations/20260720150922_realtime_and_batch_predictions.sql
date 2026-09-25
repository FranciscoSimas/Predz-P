-- =============================================================================
-- Realtime for shared picks + atomic batch upsert of predictions
-- =============================================================================

-- 1) Realtime: scoreline changes must fan out to open tournament tabs
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'user_match_picks'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.user_match_picks;
  END IF;
END $$;

-- predictions already in publication (legacy); keep idempotent check
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'predictions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.predictions;
  END IF;
END $$;

-- 2) Batch upsert: all-or-nothing for a set of match predictions
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

  -- Single transaction: any failure rolls back all saves in this call
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

COMMENT ON FUNCTION public.upsert_shared_match_predictions_batch(uuid, jsonb) IS
  'Atomically upsert many shared match predictions for the caller. Rolls back entirely on any item failure.';

-- Indexes intentionally kept even if currently "unused" (advisor INFO):
-- they target hot paths once predictions grow (match scoring, user reads, scheduled sync).
-- Do not drop idx_predictions_*, idx_user_match_picks_*, idx_matches_scheduled_* yet.
