-- Wave 1C: shared predictions across tournaments of the same competition
-- Wave 2: crest overrides + competition logo fixes
-- Wave 4: Champions League seed + knockout-aware scoring
-- Wave 5 prep: Europa League row (api-football)

-- =============================================================================
-- Shared match predictions (scores sync; wildcard stays per-tournament)
-- =============================================================================
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
  v_tid uuid;
  v_synced int := 0;
  v_row_id uuid;
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

  FOR v_tid IN
    SELECT t.id
    FROM public.tournaments t
    JOIN public.tournament_members tm
      ON tm.tournament_id = t.id AND tm.user_id = v_uid
    WHERE t.competition_id = v_comp
  LOOP
    INSERT INTO public.predictions AS p (
      tournament_id, user_id, match_id,
      home_pred, away_pred,
      et_home_pred, et_away_pred,
      pen_home_pred, pen_away_pred,
      is_wildcard
    ) VALUES (
      v_tid, v_uid, _match_id,
      _home_pred, _away_pred,
      _et_home_pred, _et_away_pred,
      _pen_home_pred, _pen_away_pred,
      CASE WHEN v_tid = COALESCE(_tournament_id, v_tid) THEN COALESCE(_is_wildcard, false) ELSE false END
    )
    ON CONFLICT (tournament_id, user_id, match_id) DO UPDATE SET
      home_pred = EXCLUDED.home_pred,
      away_pred = EXCLUDED.away_pred,
      et_home_pred = EXCLUDED.et_home_pred,
      et_away_pred = EXCLUDED.et_away_pred,
      pen_home_pred = EXCLUDED.pen_home_pred,
      pen_away_pred = EXCLUDED.pen_away_pred,
      is_wildcard = CASE
        WHEN p.tournament_id = COALESCE(_tournament_id, p.tournament_id)
          THEN EXCLUDED.is_wildcard
        ELSE p.is_wildcard
      END,
      updated_at = now()
    RETURNING id INTO v_row_id;

    v_synced := v_synced + 1;
  END LOOP;

  IF v_synced = 0 THEN
    RAISE EXCEPTION 'not a member of any tournament for this competition';
  END IF;

  RETURN jsonb_build_object(
    'synced_tournaments', v_synced,
    'match_id', _match_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_shared_match_prediction(
  uuid, int, int, int, int, int, int, boolean, uuid
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_shared_match_prediction(
  uuid, int, int, int, int, int, int, boolean, uuid
) TO authenticated;

-- =============================================================================
-- Crest overrides (sync must not overwrite)
-- =============================================================================
ALTER TABLE public.competition_teams
  ADD COLUMN IF NOT EXISTS crest_override_url text;

COMMENT ON COLUMN public.competition_teams.crest_override_url IS
  'Manual crest URL; sync providers must not overwrite when set.';

ALTER TABLE public.competitions
  ADD COLUMN IF NOT EXISTS sofascore_widget_url text;

COMMENT ON COLUMN public.competitions.sofascore_widget_url IS
  'Optional Sofascore iframe src for standings/context embed. Never used for scoring.';

-- Prefer override in UI via coalesce — also expose a view helper later if needed.
-- Seed known stale crests (Alverca / Liga Portugal)
UPDATE public.competition_teams ct
SET crest_override_url = 'https://fcalvercafutebolsad.pt/wp-content/uploads/2025/07/cropped-FC_Site-1.png'
WHERE ct.crest_override_url IS NULL
  AND (
    lower(ct.name) LIKE '%alverca%'
    OR lower(coalesce(ct.short_name, '')) = 'alv'
  );

-- Competition logos (Sofascore tournament images)
UPDATE public.competitions
SET logo_url = 'https://img.sofascore.com/api/v1/unique-tournament/238/image'
WHERE external_id = 'PPL' AND external_provider = 'football-data';

UPDATE public.competitions
SET logo_url = 'https://img.sofascore.com/api/v1/unique-tournament/37/image'
WHERE external_id = 'DED' AND external_provider = 'football-data';

UPDATE public.competitions
SET logo_url = 'https://img.sofascore.com/api/v1/unique-tournament/325/image'
WHERE external_id = 'BSA' AND external_provider = 'football-data';

-- =============================================================================
-- Knockout-aware scoring: 90' outcome/exact, then ET, then pens
-- =============================================================================
DROP FUNCTION IF EXISTS public.calc_prediction_points(
  integer, integer, integer, integer, integer, integer
);

CREATE OR REPLACE FUNCTION public.calc_prediction_points(
  _home_pred INT, _away_pred INT,
  _home_score INT, _away_score INT,
  _p_outcome INT, _p_exact_bonus INT,
  _et_home_pred INT DEFAULT NULL,
  _et_away_pred INT DEFAULT NULL,
  _pen_home_pred INT DEFAULT NULL,
  _pen_away_pred INT DEFAULT NULL,
  _et_home_score INT DEFAULT NULL,
  _et_away_score INT DEFAULT NULL,
  _pen_home_score INT DEFAULT NULL,
  _pen_away_score INT DEFAULT NULL,
  _is_knockout BOOLEAN DEFAULT false
) RETURNS TABLE(points INT, exact BOOLEAN)
LANGUAGE plpgsql IMMUTABLE
SET search_path = pg_catalog
AS $$
DECLARE
  pred_sign INT;
  real_sign INT;
  p INT := 0;
  ex BOOLEAN := false;
  effective_home INT;
  effective_away INT;
  pred_home INT;
  pred_away INT;
BEGIN
  IF _home_pred IS NULL OR _away_pred IS NULL
     OR _home_score IS NULL OR _away_score IS NULL THEN
    RETURN QUERY SELECT 0, false;
    RETURN;
  END IF;

  -- Base: 90-minute score
  pred_sign := sign(_home_pred - _away_pred);
  real_sign := sign(_home_score - _away_score);

  IF pred_sign = real_sign THEN
    p := _p_outcome;
    IF _home_pred = _home_score AND _away_pred = _away_score THEN
      p := p + _p_exact_bonus;
      ex := true;
    END IF;
  END IF;

  -- Knockout: if 90' drawn, also score ET / pens when both sides predicted them
  IF _is_knockout AND _home_score = _away_score THEN
    IF _et_home_score IS NOT NULL AND _et_away_score IS NOT NULL
       AND _et_home_pred IS NOT NULL AND _et_away_pred IS NOT NULL THEN
      IF sign(_et_home_pred - _et_away_pred) = sign(_et_home_score - _et_away_score) THEN
        p := p + greatest(_p_outcome / 2, 1);
        IF _et_home_pred = _et_home_score AND _et_away_pred = _et_away_score THEN
          p := p + greatest(_p_exact_bonus / 2, 1);
        END IF;
      END IF;
    END IF;

    IF _pen_home_score IS NOT NULL AND _pen_away_score IS NOT NULL
       AND _pen_home_pred IS NOT NULL AND _pen_away_pred IS NOT NULL THEN
      IF sign(_pen_home_pred - _pen_away_pred) = sign(_pen_home_score - _pen_away_score) THEN
        p := p + greatest(_p_outcome / 2, 1);
      END IF;
    END IF;

    -- Winner after FT+ET+PEN for advancement feel
    effective_home := COALESCE(_pen_home_score, _et_home_score, _home_score);
    effective_away := COALESCE(_pen_away_score, _et_away_score, _away_score);
    pred_home := COALESCE(_pen_home_pred, _et_home_pred, _home_pred);
    pred_away := COALESCE(_pen_away_pred, _et_away_pred, _away_pred);
    IF effective_home IS DISTINCT FROM effective_away
       AND sign(pred_home - pred_away) = sign(effective_home - effective_away)
       AND pred_sign <> real_sign THEN
      -- User missed 90' but got the eventual winner via ET/pen preds
      p := greatest(p, greatest(_p_outcome / 2, 1));
    END IF;
  END IF;

  RETURN QUERY SELECT p, ex;
END;
$$;

CREATE OR REPLACE FUNCTION public.recalc_match_predictions()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  r RECORD;
  calc RECORD;
  v_knockout boolean := false;
BEGIN
  IF NEW.home_score IS NULL OR NEW.away_score IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND
     NEW.home_score IS NOT DISTINCT FROM OLD.home_score AND
     NEW.away_score IS NOT DISTINCT FROM OLD.away_score AND
     NEW.et_home_score IS NOT DISTINCT FROM OLD.et_home_score AND
     NEW.et_away_score IS NOT DISTINCT FROM OLD.et_away_score AND
     NEW.pen_home_score IS NOT DISTINCT FROM OLD.pen_home_score AND
     NEW.pen_away_score IS NOT DISTINCT FROM OLD.pen_away_score AND
     NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  SELECT c.format IN (
    'groups_then_knockout',
    'league_phase_then_knockout',
    'groups_then_finals',
    'knockout_only'
  ) OR COALESCE(NEW.phase, '') ILIKE '%knock%' OR COALESCE(NEW.phase, '') ILIKE '%final%'
  INTO v_knockout
  FROM public.competitions c
  WHERE c.id = NEW.competition_id;

  FOR r IN
    SELECT p.id, p.tournament_id, p.home_pred, p.away_pred,
           p.et_home_pred, p.et_away_pred, p.pen_home_pred, p.pen_away_pred,
           ts.points_outcome, ts.points_exact_bonus
    FROM public.predictions p
    JOIN public.tournament_settings ts ON ts.tournament_id = p.tournament_id
    WHERE p.match_id = NEW.id
  LOOP
    SELECT * INTO calc FROM public.calc_prediction_points(
      r.home_pred, r.away_pred, NEW.home_score, NEW.away_score,
      r.points_outcome, r.points_exact_bonus,
      r.et_home_pred, r.et_away_pred, r.pen_home_pred, r.pen_away_pred,
      NEW.et_home_score, NEW.et_away_score, NEW.pen_home_score, NEW.pen_away_score,
      COALESCE(v_knockout, false)
    );
    UPDATE public.predictions
    SET points = calc.points, exact = calc.exact
    WHERE id = r.id;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_recalc_predictions ON public.matches;
DROP TRIGGER IF EXISTS trg_recalc_match_predictions ON public.matches;
CREATE TRIGGER trg_recalc_match_predictions
  AFTER INSERT OR UPDATE OF home_score, away_score, et_home_score, et_away_score,
    pen_home_score, pen_away_score, status, phase
  ON public.matches
  FOR EACH ROW EXECUTE FUNCTION public.recalc_match_predictions();

-- =============================================================================
-- Champions League (football-data free) + Europa League (api-football)
-- =============================================================================
INSERT INTO public.competitions (
  slug, name, country, season, format,
  external_provider, external_id, is_active, logo_url, default_settings
) VALUES
  (
    'champions-league-26-27',
    'UEFA Champions League',
    'Europa',
    '26/27',
    'league_phase_then_knockout',
    'football-data',
    'CL',
    true,
    'https://img.sofascore.com/api/v1/unique-tournament/7/image',
    '{"points_outcome":1,"points_exact_bonus":2,"wildcard_enabled":false,"wildcard_per_round":1,"wildcard_multiplier":2,"wildcard_scope":"per_matchday","win_streak_enabled":false,"win_streak_threshold":3,"win_streak_bonus":2,"special_bets_enabled":false,"special_bet_winner_enabled":true,"special_bet_top_scorer_enabled":true,"special_bet_best_defense_enabled":false,"points_winner":25,"points_top_scorer":25,"points_best_defense":15}'::jsonb
  ),
  (
    'europa-league-26-27',
    'UEFA Europa League',
    'Europa',
    '26/27',
    'league_phase_then_knockout',
    'api-football',
    '3',
    true,
    'https://img.sofascore.com/api/v1/unique-tournament/679/image',
    '{"points_outcome":1,"points_exact_bonus":2,"wildcard_enabled":false,"wildcard_per_round":1,"wildcard_multiplier":2,"wildcard_scope":"per_matchday","win_streak_enabled":false,"win_streak_threshold":3,"win_streak_bonus":2,"special_bets_enabled":false,"special_bet_winner_enabled":true,"special_bet_top_scorer_enabled":true,"special_bet_best_defense_enabled":false,"points_winner":25,"points_top_scorer":25,"points_best_defense":15}'::jsonb
  )
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  country = EXCLUDED.country,
  season = EXCLUDED.season,
  format = EXCLUDED.format,
  external_provider = EXCLUDED.external_provider,
  external_id = EXCLUDED.external_id,
  is_active = EXCLUDED.is_active,
  logo_url = EXCLUDED.logo_url,
  default_settings = COALESCE(public.competitions.default_settings, EXCLUDED.default_settings);

-- Official Predz tournaments for new competitions (owner = existing platform admin seed)
DO $$
DECLARE
  c RECORD;
  v_code text;
  v_owner uuid := 'ca488990-6ba6-4bd6-a9e4-7591581d9332';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = v_owner) THEN
    RETURN;
  END IF;

  FOR c IN
    SELECT id, name, season FROM public.competitions
    WHERE is_active = true
      AND slug IN ('champions-league-26-27', 'europa-league-26-27')
  LOOP
    IF EXISTS (SELECT 1 FROM public.tournaments WHERE competition_id = c.id AND is_official) THEN
      CONTINUE;
    END IF;
    LOOP
      v_code := upper(substr(md5(gen_random_uuid()::text), 1, 6));
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.tournaments WHERE join_code = v_code);
    END LOOP;
    INSERT INTO public.tournaments (
      name, description, join_code, owner_id, competition_id,
      is_public, is_official, cover_color
    ) VALUES (
      'Oficial Predz · ' || c.name,
      'Torneio oficial Predz da ' || c.name || ' ' || c.season || '. Aberto a todos — entra só se quiseres.',
      v_code,
      v_owner,
      c.id,
      true,
      true,
      '#22C55E'
    );
  END LOOP;
END $$;
