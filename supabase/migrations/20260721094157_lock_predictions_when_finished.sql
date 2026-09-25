-- Lock shared prediction upserts when match has kicked off OR is live/finished
-- (covers manual results before real kickoff time).

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
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_comp uuid;
  v_kickoff timestamptz;
  v_status public.match_status;
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

  IF _tournament_id IS NOT NULL THEN
    IF NOT private.is_tournament_member(_tournament_id) THEN
      RAISE EXCEPTION 'not a member of this tournament';
    END IF;
    IF NOT private.is_active_tournament_member(_tournament_id) THEN
      RAISE EXCEPTION 'withdrawn from this tournament';
    END IF;
  END IF;

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
