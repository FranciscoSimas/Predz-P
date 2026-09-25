-- =============================================================================
-- Post-audit hardening after shared picks review
-- =============================================================================

-- 1) Predictions writes: RPC-only (close pick_id hijack via client INSERT)
REVOKE INSERT, UPDATE ON public.predictions FROM authenticated;
-- Keep SELECT/DELETE for own rows (RLS still applies)
GRANT SELECT, DELETE ON public.predictions TO authenticated;

-- 2) Creating a tournament should attach existing shared picks for the owner
CREATE OR REPLACE FUNCTION public.add_owner_as_member()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_defaults JSONB;
BEGIN
  INSERT INTO public.tournament_members (tournament_id, user_id, role)
  VALUES (NEW.id, NEW.owner_id, 'owner')
  ON CONFLICT DO NOTHING;

  SELECT COALESCE(default_settings, '{}'::jsonb) INTO v_defaults
  FROM public.competitions WHERE id = NEW.competition_id;

  INSERT INTO public.tournament_settings (
    tournament_id,
    points_outcome, points_exact_bonus,
    wildcard_enabled, wildcard_per_round, wildcard_multiplier, wildcard_scope,
    win_streak_enabled, win_streak_threshold, win_streak_bonus, win_streak_mode,
    special_bets_enabled,
    special_bet_winner_enabled, special_bet_top_scorer_enabled, special_bet_best_defense_enabled,
    points_winner, points_top_scorer, points_best_defense,
    top_scorer_mode, points_top_scorer_per_goal,
    winner_points_mode
  ) VALUES (
    NEW.id,
    COALESCE((v_defaults->>'points_outcome')::INT, 1),
    COALESCE((v_defaults->>'points_exact_bonus')::INT, 2),
    COALESCE((v_defaults->>'wildcard_enabled')::BOOLEAN, false),
    COALESCE((v_defaults->>'wildcard_per_round')::INT, 1),
    COALESCE((v_defaults->>'wildcard_multiplier')::INT, 2),
    COALESCE(v_defaults->>'wildcard_scope', 'per_matchday'),
    COALESCE((v_defaults->>'win_streak_enabled')::BOOLEAN, false),
    COALESCE((v_defaults->>'win_streak_threshold')::INT, 3),
    COALESCE((v_defaults->>'win_streak_bonus')::INT, 2),
    COALESCE(v_defaults->>'win_streak_mode', 'bonus_points'),
    COALESCE((v_defaults->>'special_bets_enabled')::BOOLEAN, false),
    COALESCE((v_defaults->>'special_bet_winner_enabled')::BOOLEAN, true),
    COALESCE((v_defaults->>'special_bet_top_scorer_enabled')::BOOLEAN, true),
    COALESCE((v_defaults->>'special_bet_best_defense_enabled')::BOOLEAN, false),
    COALESCE((v_defaults->>'points_winner')::INT, 20),
    COALESCE((v_defaults->>'points_top_scorer')::INT, 20),
    COALESCE((v_defaults->>'points_best_defense')::INT, 15),
    COALESCE(v_defaults->>'top_scorer_mode', 'player_match'),
    COALESCE((v_defaults->>'points_top_scorer_per_goal')::INT, 1),
    COALESCE(v_defaults->>'winner_points_mode', 'final_only')
  )
  ON CONFLICT (tournament_id) DO NOTHING;

  -- Link owner's existing shared picks for this competition
  PERFORM private.attach_existing_picks(NEW.id, NEW.owner_id);

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.add_owner_as_member() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_owner_as_member() TO service_role;

-- 3) Don't wipe ET/pen when UI only sends 90' score
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

  IF NOT EXISTS (
    SELECT 1
    FROM public.tournaments t
    JOIN public.tournament_members tm
      ON tm.tournament_id = t.id AND tm.user_id = v_uid
    WHERE t.competition_id = v_comp
  ) THEN
    RAISE EXCEPTION 'not a member of any tournament for this competition';
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

-- 4) Deduplicate prediction lock triggers
DROP TRIGGER IF EXISTS trg_lock_predictions_ins ON public.predictions;
DROP TRIGGER IF EXISTS trg_lock_predictions_upd ON public.predictions;
-- keep trg_lock_predictions (BEFORE INSERT OR UPDATE)

-- 5) private.join_code_attempts: enable RLS (no policies → deny client roles)
-- Table is only touched by SECURITY DEFINER RPCs.
ALTER TABLE private.join_code_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.join_code_attempts FROM anon, authenticated;
GRANT ALL ON TABLE private.join_code_attempts TO service_role;
