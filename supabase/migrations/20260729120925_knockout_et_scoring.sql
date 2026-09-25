-- Knockout legs + ET/PEN scoring (defaults O/E -> max 5 / 7 / 17)

-- =============================================================================
-- 1. Schema: match legs + prediction point breakdown
-- =============================================================================
ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS tie_id uuid,
  ADD COLUMN IF NOT EXISTS leg_kind text;

ALTER TABLE public.matches
  DROP CONSTRAINT IF EXISTS matches_leg_kind_check;

ALTER TABLE public.matches
  ADD CONSTRAINT matches_leg_kind_check
  CHECK (
    leg_kind IS NULL
    OR leg_kind = ANY (ARRAY[
      'single'::text,
      'first'::text,
      'second'::text,
      'replay'::text,
      'final_single'::text
    ])
  );

CREATE INDEX IF NOT EXISTS matches_tie_id_idx ON public.matches (tie_id)
  WHERE tie_id IS NOT NULL;

COMMENT ON COLUMN public.matches.tie_id IS
  'Groups both legs of the same knockout tie.';
COMMENT ON COLUMN public.matches.leg_kind IS
  'single|first|second|replay|final_single; null = league / non-decisive.';

ALTER TABLE public.predictions
  ADD COLUMN IF NOT EXISTS points_advancement numeric(10,1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS points_90 numeric(10,1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS points_et numeric(10,1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS points_pen numeric(10,1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS points_before_multiplier numeric(10,1) NOT NULL DEFAULT 0;

DROP VIEW IF EXISTS public.prediction_entries;

CREATE OR REPLACE VIEW public.prediction_entries
WITH (security_invoker = true)
AS
SELECT
  p.id,
  p.tournament_id,
  p.user_id,
  p.match_id,
  p.pick_id,
  p.is_wildcard,
  p.points,
  p.exact,
  p.points_advancement,
  p.points_90,
  p.points_et,
  p.points_pen,
  p.points_before_multiplier,
  p.created_at,
  p.updated_at,
  pk.home_pred,
  pk.away_pred,
  pk.et_home_pred,
  pk.et_away_pred,
  pk.pen_home_pred,
  pk.pen_away_pred
FROM public.predictions p
JOIN public.user_match_picks pk ON pk.id = p.pick_id;

GRANT SELECT ON public.prediction_entries TO authenticated;

-- =============================================================================
-- 2. Helpers: outcome / aggregate / advance / gate
-- =============================================================================
CREATE OR REPLACE FUNCTION private.score_outcome_points(
  _home_pred int,
  _away_pred int,
  _home_score int,
  _away_score int,
  _p_outcome int,
  _p_exact_bonus int
)
RETURNS TABLE(points int, exact boolean)
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog
AS $$
DECLARE
  p int := 0;
  ex boolean := false;
BEGIN
  IF _home_pred IS NULL OR _away_pred IS NULL
     OR _home_score IS NULL OR _away_score IS NULL THEN
    RETURN QUERY SELECT 0, false;
    RETURN;
  END IF;
  IF sign(_home_pred - _away_pred) = sign(_home_score - _away_score) THEN
    p := COALESCE(_p_outcome, 0);
    IF _home_pred = _home_score AND _away_pred = _away_score THEN
      p := p + COALESCE(_p_exact_bonus, 0);
      ex := true;
    END IF;
  END IF;
  RETURN QUERY SELECT p, ex;
END;
$$;

CREATE OR REPLACE FUNCTION private.team_goals_from_pair(
  _home_team uuid,
  _away_team uuid,
  _home int,
  _away int,
  _target uuid
)
RETURNS int
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT CASE
    WHEN _target IS NULL OR _home IS NULL OR _away IS NULL THEN NULL
    WHEN _target = _home_team THEN _home
    WHEN _target = _away_team THEN _away
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION private.aggregate_goals_for_team(
  _first_home_team uuid,
  _first_away_team uuid,
  _first_home int,
  _first_away int,
  _second_home_team uuid,
  _second_away_team uuid,
  _second_home int,
  _second_away int,
  _team uuid
)
RETURNS int
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT
    COALESCE(private.team_goals_from_pair(
      _first_home_team, _first_away_team, _first_home, _first_away, _team
    ), 0)
    + COALESCE(private.team_goals_from_pair(
      _second_home_team, _second_away_team, _second_home, _second_away, _team
    ), 0);
$$;

CREATE OR REPLACE FUNCTION private.resolve_advancing_team_id(
  _leg_kind text,
  _home_team uuid,
  _away_team uuid,
  _home90 int,
  _away90 int,
  _et_home int,
  _et_away int,
  _pen_home int,
  _pen_away int,
  _first_home_team uuid DEFAULT NULL,
  _first_away_team uuid DEFAULT NULL,
  _first_home int DEFAULT NULL,
  _first_away int DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog
AS $$
DECLARE
  h90 int;
  a90 int;
  h120 int;
  a120 int;
BEGIN
  IF _leg_kind IS NULL OR _leg_kind = 'first' THEN
    RETURN NULL;
  END IF;

  IF _leg_kind = 'second'
     AND _first_home_team IS NOT NULL
     AND _first_away_team IS NOT NULL
     AND _first_home IS NOT NULL
     AND _first_away IS NOT NULL THEN
    h90 := private.aggregate_goals_for_team(
      _first_home_team, _first_away_team, _first_home, _first_away,
      _home_team, _away_team, _home90, _away90, _home_team
    );
    a90 := private.aggregate_goals_for_team(
      _first_home_team, _first_away_team, _first_home, _first_away,
      _home_team, _away_team, _home90, _away90, _away_team
    );
    IF h90 <> a90 THEN
      RETURN CASE WHEN h90 > a90 THEN _home_team ELSE _away_team END;
    END IF;
    IF _et_home IS NULL OR _et_away IS NULL THEN
      RETURN NULL;
    END IF;
    h120 := private.aggregate_goals_for_team(
      _first_home_team, _first_away_team, _first_home, _first_away,
      _home_team, _away_team, _et_home, _et_away, _home_team
    );
    a120 := private.aggregate_goals_for_team(
      _first_home_team, _first_away_team, _first_home, _first_away,
      _home_team, _away_team, _et_home, _et_away, _away_team
    );
    IF h120 <> a120 THEN
      RETURN CASE WHEN h120 > a120 THEN _home_team ELSE _away_team END;
    END IF;
    IF _pen_home IS NULL OR _pen_away IS NULL OR _pen_home = _pen_away THEN
      RETURN NULL;
    END IF;
    RETURN CASE WHEN _pen_home > _pen_away THEN _home_team ELSE _away_team END;
  END IF;

  -- single / final_single / replay
  IF _home90 IS DISTINCT FROM _away90 THEN
    RETURN CASE WHEN _home90 > _away90 THEN _home_team ELSE _away_team END;
  END IF;
  IF _et_home IS NULL OR _et_away IS NULL THEN
    RETURN NULL;
  END IF;
  IF _et_home IS DISTINCT FROM _et_away THEN
    RETURN CASE WHEN _et_home > _et_away THEN _home_team ELSE _away_team END;
  END IF;
  IF _pen_home IS NULL OR _pen_away IS NULL OR _pen_home = _pen_away THEN
    RETURN NULL;
  END IF;
  RETURN CASE WHEN _pen_home > _pen_away THEN _home_team ELSE _away_team END;
END;
$$;

CREATE OR REPLACE FUNCTION private.effective_leg_kind(
  _leg_kind text,
  _phase text,
  _is_knockout_comp boolean
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT CASE
    WHEN _leg_kind IS NOT NULL THEN _leg_kind
    WHEN NOT COALESCE(_is_knockout_comp, false) THEN NULL
    WHEN COALESCE(_phase, '') ILIKE '%league%'
      OR COALESCE(_phase, '') IN ('regular', 'groups', 'group') THEN NULL
    WHEN COALESCE(_phase, '') ILIKE '%final%'
      AND COALESCE(_phase, '') NOT ILIKE '%semi%'
      AND COALESCE(_phase, '') NOT ILIKE '%quarter%' THEN 'final_single'
    WHEN COALESCE(_phase, '') ILIKE '%knock%'
      OR COALESCE(_phase, '') ILIKE '%final%'
      OR COALESCE(_phase, '') ILIKE '%play%off%'
      OR COALESCE(_phase, '') ILIKE '%round_of%'
      OR COALESCE(_phase, '') ILIKE '%last_16%'
      OR COALESCE(_phase, '') ILIKE '%quarter%'
      OR COALESCE(_phase, '') ILIKE '%semi%' THEN 'single'
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION private.knockout_et_gate_open(
  _leg_kind text,
  _home90 int,
  _away90 int,
  _first_home int DEFAULT NULL,
  _first_away int DEFAULT NULL,
  _first_home_team uuid DEFAULT NULL,
  _first_away_team uuid DEFAULT NULL,
  _second_home_team uuid DEFAULT NULL,
  _second_away_team uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog
AS $$
DECLARE
  h int;
  a int;
BEGIN
  IF _leg_kind IS NULL OR _leg_kind = 'first' THEN
    RETURN false;
  END IF;
  IF _home90 IS NULL OR _away90 IS NULL THEN
    RETURN false;
  END IF;
  IF _leg_kind IN ('single', 'final_single', 'replay') THEN
    RETURN _home90 = _away90;
  END IF;
  IF _leg_kind = 'second' THEN
    IF _first_home IS NULL OR _first_away IS NULL
       OR _first_home_team IS NULL OR _first_away_team IS NULL
       OR _second_home_team IS NULL OR _second_away_team IS NULL THEN
      RETURN false;
    END IF;
    h := private.aggregate_goals_for_team(
      _first_home_team, _first_away_team, _first_home, _first_away,
      _second_home_team, _second_away_team, _home90, _away90, _second_home_team
    );
    a := private.aggregate_goals_for_team(
      _first_home_team, _first_away_team, _first_home, _first_away,
      _second_home_team, _second_away_team, _home90, _away90, _second_away_team
    );
    RETURN h = a;
  END IF;
  RETURN false;
END;
$$;

-- =============================================================================
-- 3. Scoring function (breakdown)
-- =============================================================================
DROP FUNCTION IF EXISTS public.calc_prediction_points(
  int, int, int, int, int, int, int, int, int, int, int, int, int, int, boolean
);

CREATE OR REPLACE FUNCTION public.calc_prediction_points(
  _home_pred int,
  _away_pred int,
  _home_score int,
  _away_score int,
  _p_outcome int,
  _p_exact_bonus int,
  _et_home_pred int DEFAULT NULL,
  _et_away_pred int DEFAULT NULL,
  _pen_home_pred int DEFAULT NULL,
  _pen_away_pred int DEFAULT NULL,
  _et_home_score int DEFAULT NULL,
  _et_away_score int DEFAULT NULL,
  _pen_home_score int DEFAULT NULL,
  _pen_away_score int DEFAULT NULL,
  _leg_kind text DEFAULT NULL,
  _home_team uuid DEFAULT NULL,
  _away_team uuid DEFAULT NULL,
  _first_home_team uuid DEFAULT NULL,
  _first_away_team uuid DEFAULT NULL,
  _first_home_score int DEFAULT NULL,
  _first_away_score int DEFAULT NULL,
  _first_home_pred int DEFAULT NULL,
  _first_away_pred int DEFAULT NULL
)
RETURNS TABLE(
  points int,
  exact boolean,
  points_advancement int,
  points_90 int,
  points_et int,
  points_pen int
)
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog
AS $$
DECLARE
  o int := COALESCE(_p_outcome, 0);
  e int := COALESCE(_p_exact_bonus, 0);
  base record;
  et_part record;
  p_adv int := 0;
  p90 int := 0;
  p_et int := 0;
  p_pen int := 0;
  ex90 boolean := false;
  decisive boolean;
  had_et boolean;
  had_pen boolean;
  real_adv uuid;
  pred_adv uuid;
  first_home int;
  first_away int;
BEGIN
  IF _home_pred IS NULL OR _away_pred IS NULL
     OR _home_score IS NULL OR _away_score IS NULL THEN
    RETURN QUERY SELECT 0, false, 0, 0, 0, 0;
    RETURN;
  END IF;

  SELECT * INTO base FROM private.score_outcome_points(
    _home_pred, _away_pred, _home_score, _away_score, o, e
  );
  p90 := base.points;
  ex90 := base.exact;

  decisive := _leg_kind IN ('second', 'single', 'final_single', 'replay');
  had_et := _et_home_score IS NOT NULL AND _et_away_score IS NOT NULL;
  had_pen := _pen_home_score IS NOT NULL AND _pen_away_score IS NOT NULL;

  IF decisive AND had_et
     AND _et_home_pred IS NOT NULL AND _et_away_pred IS NOT NULL
     AND (
       (_leg_kind IN ('single', 'final_single', 'replay') AND _home_score = _away_score)
       OR (
         _leg_kind = 'second'
         AND private.knockout_et_gate_open(
           'second', _home_score, _away_score,
           _first_home_score, _first_away_score,
           _first_home_team, _first_away_team,
           _home_team, _away_team
         )
       )
     )
  THEN
    SELECT * INTO et_part FROM private.score_outcome_points(
      _et_home_pred, _et_away_pred, _et_home_score, _et_away_score, o, e
    );
    p_et := et_part.points;
  END IF;

  IF decisive AND had_pen
     AND _pen_home_pred IS NOT NULL AND _pen_away_pred IS NOT NULL
     AND had_et
     AND _et_home_score = _et_away_score
     AND _pen_home_pred = _pen_home_score
     AND _pen_away_pred = _pen_away_score
  THEN
    p_pen := o + e;
  END IF;

  IF decisive AND _home_team IS NOT NULL AND _away_team IS NOT NULL THEN
    first_home := _first_home_score;
    first_away := _first_away_score;
    -- For predicted advance on second leg before first finishes, caller may pass preds as first scores.
    IF first_home IS NULL THEN first_home := _first_home_pred; END IF;
    IF first_away IS NULL THEN first_away := _first_away_pred; END IF;

    real_adv := private.resolve_advancing_team_id(
      _leg_kind, _home_team, _away_team,
      _home_score, _away_score,
      _et_home_score, _et_away_score,
      _pen_home_score, _pen_away_score,
      _first_home_team, _first_away_team,
      CASE WHEN _leg_kind = 'second' THEN _first_home_score END,
      CASE WHEN _leg_kind = 'second' THEN _first_away_score END
    );
    pred_adv := private.resolve_advancing_team_id(
      _leg_kind, _home_team, _away_team,
      _home_pred, _away_pred,
      _et_home_pred, _et_away_pred,
      _pen_home_pred, _pen_away_pred,
      _first_home_team, _first_away_team,
      CASE WHEN _leg_kind = 'second' THEN first_home END,
      CASE WHEN _leg_kind = 'second' THEN first_away END
    );
    IF real_adv IS NOT NULL AND pred_adv IS NOT NULL AND real_adv = pred_adv THEN
      p_adv := o;
    END IF;
  END IF;

  RETURN QUERY SELECT
    (p_adv + p90 + p_et + p_pen)::int,
    ex90,
    p_adv,
    p90,
    p_et,
    p_pen;
END;
$$;

REVOKE ALL ON FUNCTION public.calc_prediction_points(
  int, int, int, int, int, int, int, int, int, int, int, int, int, int,
  text, uuid, uuid, uuid, uuid, int, int, int, int
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calc_prediction_points(
  int, int, int, int, int, int, int, int, int, int, int, int, int, int,
  text, uuid, uuid, uuid, uuid, int, int, int, int
) TO service_role;

-- =============================================================================
-- 4. Recalc trigger (incl. sibling leg of a tie)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.recalc_predictions_for_match(_match_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m public.matches%ROWTYPE;
  sibling public.matches%ROWTYPE;
  v_knockout boolean := false;
  v_leg text;
  t RECORD;
  first_home_team uuid;
  first_away_team uuid;
  first_home int;
  first_away int;
BEGIN
  SELECT * INTO m FROM public.matches WHERE id = _match_id;
  IF NOT FOUND OR m.home_score IS NULL OR m.away_score IS NULL THEN
    RETURN;
  END IF;

  SELECT c.format IN (
    'groups_then_knockout',
    'league_phase_then_knockout',
    'groups_then_finals',
    'knockout_only'
  )
  INTO v_knockout
  FROM public.competitions c
  WHERE c.id = m.competition_id;

  v_leg := private.effective_leg_kind(m.leg_kind, m.phase, COALESCE(v_knockout, false));

  first_home_team := NULL;
  first_away_team := NULL;
  first_home := NULL;
  first_away := NULL;
  IF v_leg = 'second' AND m.tie_id IS NOT NULL THEN
    SELECT * INTO sibling
    FROM public.matches s
    WHERE s.tie_id = m.tie_id
      AND s.id <> m.id
      AND COALESCE(s.leg_kind, '') = 'first'
    LIMIT 1;
    IF FOUND THEN
      first_home_team := sibling.home_team_id;
      first_away_team := sibling.away_team_id;
      first_home := sibling.home_score;
      first_away := sibling.away_score;
    END IF;
  END IF;

  UPDATE public.predictions p
  SET
    points_advancement = calc.points_advancement::numeric(10,1),
    points_90 = calc.points_90::numeric(10,1),
    points_et = calc.points_et::numeric(10,1),
    points_pen = calc.points_pen::numeric(10,1),
    points_before_multiplier = calc.points::numeric(10,1),
    points = CASE
      WHEN p.is_wildcard AND COALESCE(ts.wildcard_enabled, false) AND calc.points > 0
        THEN (calc.points::numeric(10,1) * GREATEST(COALESCE(ts.wildcard_multiplier, 1), 1))::numeric(10,1)
      ELSE calc.points::numeric(10,1)
    END,
    exact = calc.exact
  FROM public.user_match_picks pk,
       public.tournament_settings ts,
       LATERAL public.calc_prediction_points(
         pk.home_pred, pk.away_pred, m.home_score, m.away_score,
         ts.points_outcome, ts.points_exact_bonus,
         pk.et_home_pred, pk.et_away_pred, pk.pen_home_pred, pk.pen_away_pred,
         m.et_home_score, m.et_away_score, m.pen_home_score, m.pen_away_score,
         v_leg,
         m.home_team_id, m.away_team_id,
         first_home_team, first_away_team,
         first_home, first_away,
         NULL, NULL
       ) AS calc
  WHERE p.match_id = m.id
    AND pk.id = p.pick_id
    AND ts.tournament_id = p.tournament_id;

  -- When first leg finishes, also recalc second leg (advancement / ET gates).
  IF m.tie_id IS NOT NULL AND COALESCE(m.leg_kind, v_leg) = 'first' THEN
    PERFORM public.recalc_predictions_for_match(s.id)
    FROM public.matches s
    WHERE s.tie_id = m.tie_id
      AND s.id <> m.id
      AND COALESCE(s.leg_kind, '') = 'second'
      AND s.home_score IS NOT NULL
      AND s.away_score IS NOT NULL;
  END IF;

  PERFORM public.refresh_pred_stats_for_match(m.id);

  FOR t IN
    SELECT id FROM public.tournaments WHERE competition_id = m.competition_id
  LOOP
    PERFORM public.recalc_tournament_streaks(t.id);
    IF m.status = 'finished' THEN
      PERFORM public.recalc_special_bets(t.id);
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.recalc_predictions_for_match(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recalc_predictions_for_match(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.recalc_match_predictions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
     NEW.status IS NOT DISTINCT FROM OLD.status AND
     NEW.leg_kind IS NOT DISTINCT FROM OLD.leg_kind AND
     NEW.tie_id IS NOT DISTINCT FROM OLD.tie_id AND
     NEW.phase IS NOT DISTINCT FROM OLD.phase THEN
    RETURN NEW;
  END IF;

  PERFORM public.recalc_predictions_for_match(NEW.id);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.recalc_match_predictions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recalc_match_predictions() TO service_role;

-- =============================================================================
-- 5. Upsert: clear/validate ET/PEN by gate
-- =============================================================================
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
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_comp uuid;
  v_kickoff timestamptz;
  v_status public.match_status;
  v_pick_id uuid;
  v_tid uuid;
  v_synced integer := 0;
  m public.matches%ROWTYPE;
  sibling public.matches%ROWTYPE;
  v_knockout boolean := false;
  v_leg text;
  v_et_home int := _et_home_pred;
  v_et_away int := _et_away_pred;
  v_pen_home int := _pen_home_pred;
  v_pen_away int := _pen_away_pred;
  first_home int;
  first_away int;
  first_home_pred int;
  first_away_pred int;
  gate_et boolean;
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

  SELECT * INTO m FROM public.matches WHERE id = _match_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'match not found';
  END IF;
  v_comp := m.competition_id;
  v_kickoff := m.kickoff_at;
  v_status := m.status;

  IF v_kickoff <= now() OR v_status IN ('live', 'finished') THEN
    RAISE EXCEPTION 'match already started';
  END IF;

  IF _tournament_id IS NOT NULL
    AND NOT private.is_active_tournament_player(_tournament_id) THEN
    RAISE EXCEPTION 'only active players can submit predictions';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.tournaments t
    JOIN public.tournament_members tm
      ON tm.tournament_id = t.id
     AND tm.user_id = v_uid
    WHERE t.competition_id = v_comp
      AND tm.withdrawn_at IS NULL
      AND tm.role <> 'spectator'::public.tournament_role
  ) THEN
    RAISE EXCEPTION 'not an active player in any tournament for this competition';
  END IF;

  SELECT c.format IN (
    'groups_then_knockout',
    'league_phase_then_knockout',
    'groups_then_finals',
    'knockout_only'
  )
  INTO v_knockout
  FROM public.competitions c
  WHERE c.id = v_comp;

  v_leg := private.effective_leg_kind(m.leg_kind, m.phase, COALESCE(v_knockout, false));

  first_home := NULL;
  first_away := NULL;
  first_home_pred := NULL;
  first_away_pred := NULL;
  IF v_leg = 'second' AND m.tie_id IS NOT NULL THEN
    SELECT * INTO sibling
    FROM public.matches s
    WHERE s.tie_id = m.tie_id
      AND s.id <> m.id
      AND COALESCE(s.leg_kind, '') = 'first'
    LIMIT 1;
    IF FOUND THEN
      IF sibling.status = 'finished'
         AND sibling.home_score IS NOT NULL
         AND sibling.away_score IS NOT NULL THEN
        first_home := sibling.home_score;
        first_away := sibling.away_score;
      ELSE
        SELECT pk.home_pred, pk.away_pred
          INTO first_home_pred, first_away_pred
        FROM public.user_match_picks pk
        WHERE pk.user_id = v_uid AND pk.match_id = sibling.id;
        first_home := first_home_pred;
        first_away := first_away_pred;
      END IF;
    END IF;
  END IF;

  gate_et := private.knockout_et_gate_open(
    v_leg, _home_pred, _away_pred,
    first_home, first_away,
    sibling.home_team_id, sibling.away_team_id,
    m.home_team_id, m.away_team_id
  );

  IF NOT gate_et THEN
    v_et_home := NULL;
    v_et_away := NULL;
    v_pen_home := NULL;
    v_pen_away := NULL;
  ELSIF v_et_home IS NULL OR v_et_away IS NULL OR v_et_home IS DISTINCT FROM v_et_away THEN
    v_pen_home := NULL;
    v_pen_away := NULL;
  END IF;

  IF v_et_home IS NOT NULL AND (v_et_home < 0 OR v_et_home > 30
     OR v_et_away IS NULL OR v_et_away < 0 OR v_et_away > 30) THEN
    RAISE EXCEPTION 'ET prediction scores must be between 0 and 30';
  END IF;
  IF v_pen_home IS NOT NULL AND (v_pen_home < 0 OR v_pen_home > 30
     OR v_pen_away IS NULL OR v_pen_away < 0 OR v_pen_away > 30) THEN
    RAISE EXCEPTION 'PEN prediction scores must be between 0 and 30';
  END IF;

  INSERT INTO public.user_match_picks AS pk (
    user_id, match_id, home_pred, away_pred,
    et_home_pred, et_away_pred, pen_home_pred, pen_away_pred
  ) VALUES (
    v_uid, _match_id, _home_pred, _away_pred,
    v_et_home, v_et_away, v_pen_home, v_pen_away
  )
  ON CONFLICT (user_id, match_id) DO UPDATE SET
    home_pred = EXCLUDED.home_pred,
    away_pred = EXCLUDED.away_pred,
    et_home_pred = EXCLUDED.et_home_pred,
    et_away_pred = EXCLUDED.et_away_pred,
    pen_home_pred = EXCLUDED.pen_home_pred,
    pen_away_pred = EXCLUDED.pen_away_pred,
    updated_at = now()
  RETURNING id INTO v_pick_id;

  FOR v_tid IN
    SELECT t.id
    FROM public.tournaments t
    JOIN public.tournament_members tm
      ON tm.tournament_id = t.id
     AND tm.user_id = v_uid
    WHERE t.competition_id = v_comp
      AND tm.withdrawn_at IS NULL
      AND tm.role <> 'spectator'::public.tournament_role
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
