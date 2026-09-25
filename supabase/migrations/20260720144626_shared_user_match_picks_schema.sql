-- =============================================================================
-- Shared scoreline picks: one placar per (user, match); tournament meta separate
-- =============================================================================
-- user_match_picks  → home/away/ET/pen (shared across tournaments of same competition)
-- predictions       → tournament_id + pick_id + wildcard + points/exact
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. user_match_picks
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_match_picks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  match_id UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  home_pred INT NOT NULL,
  away_pred INT NOT NULL,
  et_home_pred INT,
  et_away_pred INT,
  pen_home_pred INT,
  pen_away_pred INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT user_match_picks_home_range CHECK (home_pred >= 0 AND home_pred <= 30),
  CONSTRAINT user_match_picks_away_range CHECK (away_pred >= 0 AND away_pred <= 30),
  CONSTRAINT user_match_picks_et_home_range CHECK (et_home_pred IS NULL OR (et_home_pred >= 0 AND et_home_pred <= 30)),
  CONSTRAINT user_match_picks_et_away_range CHECK (et_away_pred IS NULL OR (et_away_pred >= 0 AND et_away_pred <= 30)),
  CONSTRAINT user_match_picks_pen_home_range CHECK (pen_home_pred IS NULL OR (pen_home_pred >= 0 AND pen_home_pred <= 30)),
  CONSTRAINT user_match_picks_pen_away_range CHECK (pen_away_pred IS NULL OR (pen_away_pred >= 0 AND pen_away_pred <= 30)),
  CONSTRAINT user_match_picks_user_match_key UNIQUE (user_id, match_id)
);

CREATE INDEX IF NOT EXISTS idx_user_match_picks_match
  ON public.user_match_picks (match_id);

CREATE INDEX IF NOT EXISTS idx_user_match_picks_user
  ON public.user_match_picks (user_id);

CREATE TRIGGER trg_user_match_picks_updated_at
  BEFORE UPDATE ON public.user_match_picks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.user_match_picks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_match_picks select own"
  ON public.user_match_picks FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- Writes go through SECURITY DEFINER RPCs only
REVOKE INSERT, UPDATE, DELETE ON public.user_match_picks FROM authenticated;
GRANT SELECT ON public.user_match_picks TO authenticated;
GRANT ALL ON public.user_match_picks TO service_role;

-- Lock picks after kickoff
CREATE OR REPLACE FUNCTION public.lock_user_match_picks_after_kickoff()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kickoff TIMESTAMPTZ;
BEGIN
  SELECT kickoff_at INTO v_kickoff FROM public.matches WHERE id = NEW.match_id;
  IF v_kickoff IS NOT NULL AND v_kickoff <= now() THEN
    RAISE EXCEPTION 'Prognóstico bloqueado: o jogo já começou.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lock_user_match_picks ON public.user_match_picks;
CREATE TRIGGER trg_lock_user_match_picks
  BEFORE INSERT OR UPDATE ON public.user_match_picks
  FOR EACH ROW EXECUTE FUNCTION public.lock_user_match_picks_after_kickoff();

REVOKE ALL ON FUNCTION public.lock_user_match_picks_after_kickoff() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lock_user_match_picks_after_kickoff() TO service_role;

-- -----------------------------------------------------------------------------
-- 2. Backfill picks from existing predictions (latest scoreline wins)
-- -----------------------------------------------------------------------------
INSERT INTO public.user_match_picks (
  user_id, match_id, home_pred, away_pred,
  et_home_pred, et_away_pred, pen_home_pred, pen_away_pred,
  created_at, updated_at
)
SELECT DISTINCT ON (p.user_id, p.match_id)
  p.user_id,
  p.match_id,
  p.home_pred,
  p.away_pred,
  p.et_home_pred,
  p.et_away_pred,
  p.pen_home_pred,
  p.pen_away_pred,
  p.created_at,
  p.updated_at
FROM public.predictions p
WHERE p.home_pred IS NOT NULL AND p.away_pred IS NOT NULL
ORDER BY p.user_id, p.match_id, p.updated_at DESC
ON CONFLICT (user_id, match_id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 3. Link predictions → picks; drop duplicated score columns
-- -----------------------------------------------------------------------------
ALTER TABLE public.predictions
  ADD COLUMN IF NOT EXISTS pick_id UUID REFERENCES public.user_match_picks(id) ON DELETE CASCADE;

UPDATE public.predictions p
SET pick_id = pk.id
FROM public.user_match_picks pk
WHERE pk.user_id = p.user_id
  AND pk.match_id = p.match_id
  AND p.pick_id IS NULL
  AND p.home_pred IS NOT NULL
  AND p.away_pred IS NOT NULL;

-- Orphan rows without scores (shouldn't exist) — drop them
DELETE FROM public.predictions WHERE pick_id IS NULL;

ALTER TABLE public.predictions
  ALTER COLUMN pick_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_predictions_pick
  ON public.predictions (pick_id);

-- Drop old covering index that referenced score columns
DROP INDEX IF EXISTS public.idx_predictions_tournament_user_covering;

-- Must drop triggers that reference score columns before ALTER DROP COLUMN
DROP TRIGGER IF EXISTS trg_predictions_refresh_member_stats ON public.predictions;

ALTER TABLE public.predictions
  DROP COLUMN IF EXISTS home_pred,
  DROP COLUMN IF EXISTS away_pred,
  DROP COLUMN IF EXISTS et_home_pred,
  DROP COLUMN IF EXISTS et_away_pred,
  DROP COLUMN IF EXISTS pen_home_pred,
  DROP COLUMN IF EXISTS pen_away_pred;

-- New covering index for tournament meta reads
CREATE INDEX IF NOT EXISTS idx_predictions_tournament_user_covering
  ON public.predictions (tournament_id, user_id)
  INCLUDE (match_id, pick_id, points, exact, is_wildcard);

-- Column grants: clients must not write scores (gone) or pick_id directly
REVOKE INSERT, UPDATE ON public.predictions FROM authenticated;
GRANT INSERT (tournament_id, user_id, match_id, pick_id, is_wildcard)
  ON public.predictions TO authenticated;
GRANT UPDATE (is_wildcard)
  ON public.predictions TO authenticated;
GRANT SELECT, DELETE ON public.predictions TO authenticated;

-- -----------------------------------------------------------------------------
-- 4. Convenience view for UI (security invoker + same RLS as base tables)
-- -----------------------------------------------------------------------------
DROP VIEW IF EXISTS public.prediction_entries;
CREATE VIEW public.prediction_entries
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

-- -----------------------------------------------------------------------------
-- 5. Attach existing picks when joining a tournament
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.attach_existing_picks(
  _tournament_id UUID,
  _user_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_comp UUID;
  v_knockout BOOLEAN;
BEGIN
  SELECT competition_id INTO v_comp FROM public.tournaments WHERE id = _tournament_id;
  IF v_comp IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.predictions (tournament_id, user_id, match_id, pick_id, is_wildcard)
  SELECT _tournament_id, _user_id, pk.match_id, pk.id, false
  FROM public.user_match_picks pk
  JOIN public.matches m ON m.id = pk.match_id
  WHERE pk.user_id = _user_id
    AND m.competition_id = v_comp
  ON CONFLICT (tournament_id, user_id, match_id) DO NOTHING;

  -- Score already-finished matches for this tournament
  SELECT c.format IN (
    'groups_then_knockout',
    'league_phase_then_knockout',
    'groups_then_finals',
    'knockout_only'
  ) INTO v_knockout
  FROM public.competitions c
  WHERE c.id = v_comp;

  UPDATE public.predictions p
  SET
    points = CASE
      WHEN p.is_wildcard AND COALESCE(ts.wildcard_enabled, false) AND calc.points > 0
        THEN calc.points * GREATEST(COALESCE(ts.wildcard_multiplier, 1), 1)
      ELSE calc.points
    END,
    exact = calc.exact,
    updated_at = now()
  FROM public.user_match_picks pk
  JOIN public.matches m ON m.id = pk.match_id
  JOIN public.tournament_settings ts ON ts.tournament_id = _tournament_id
  CROSS JOIN LATERAL public.calc_prediction_points(
    pk.home_pred, pk.away_pred, m.home_score, m.away_score,
    ts.points_outcome, ts.points_exact_bonus,
    pk.et_home_pred, pk.et_away_pred, pk.pen_home_pred, pk.pen_away_pred,
    m.et_home_score, m.et_away_score, m.pen_home_score, m.pen_away_score,
    COALESCE(v_knockout, false)
      OR COALESCE(m.phase, '') ILIKE '%knock%'
      OR COALESCE(m.phase, '') ILIKE '%final%'
  ) AS calc
  WHERE p.tournament_id = _tournament_id
    AND p.user_id = _user_id
    AND p.pick_id = pk.id
    AND m.home_score IS NOT NULL
    AND m.away_score IS NOT NULL;

  PERFORM public.refresh_member_pred_stats(_tournament_id, _user_id);
  PERFORM public.recalc_tournament_streaks(_tournament_id);
END;
$$;

REVOKE ALL ON FUNCTION private.attach_existing_picks(UUID, UUID) FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 6. upsert_shared_match_prediction → 1 pick + N tournament metas
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

  -- Must be member of at least one tournament for this competition
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

-- -----------------------------------------------------------------------------
-- 7. Scoring reads from picks
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recalc_match_predictions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_knockout boolean := false;
  t RECORD;
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

  UPDATE public.predictions p
  SET
    points = CASE
      WHEN p.is_wildcard AND COALESCE(ts.wildcard_enabled, false) AND calc.points > 0
        THEN calc.points * GREATEST(COALESCE(ts.wildcard_multiplier, 1), 1)
      ELSE calc.points
    END,
    exact = calc.exact
  FROM public.user_match_picks pk,
       public.tournament_settings ts,
       LATERAL public.calc_prediction_points(
         pk.home_pred, pk.away_pred, NEW.home_score, NEW.away_score,
         ts.points_outcome, ts.points_exact_bonus,
         pk.et_home_pred, pk.et_away_pred, pk.pen_home_pred, pk.pen_away_pred,
         NEW.et_home_score, NEW.et_away_score, NEW.pen_home_score, NEW.pen_away_score,
         COALESCE(v_knockout, false)
       ) AS calc
  WHERE p.match_id = NEW.id
    AND pk.id = p.pick_id
    AND ts.tournament_id = p.tournament_id;

  PERFORM public.refresh_pred_stats_for_match(NEW.id);

  FOR t IN
    SELECT id FROM public.tournaments WHERE competition_id = NEW.competition_id
  LOOP
    PERFORM public.recalc_tournament_streaks(t.id);
  END LOOP;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.recalc_match_predictions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recalc_match_predictions() TO service_role;

-- Stats: prediction row implies a pick
CREATE OR REPLACE FUNCTION public.refresh_member_pred_stats(
  _tournament_id UUID,
  _user_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.tournament_members tm
  SET
    pred_points = COALESCE((
      SELECT SUM(p.points)::INT FROM public.predictions p
      WHERE p.tournament_id = _tournament_id AND p.user_id = _user_id
    ), 0),
    correct_count = COALESCE((
      SELECT COUNT(*)::INT FROM public.predictions p
      WHERE p.tournament_id = _tournament_id AND p.user_id = _user_id AND p.points > 0
    ), 0),
    exact_count = COALESCE((
      SELECT COUNT(*)::INT FROM public.predictions p
      WHERE p.tournament_id = _tournament_id AND p.user_id = _user_id AND p.exact
    ), 0),
    predictions_made = COALESCE((
      SELECT COUNT(*)::INT FROM public.predictions p
      WHERE p.tournament_id = _tournament_id AND p.user_id = _user_id
    ), 0),
    wildcards_used = COALESCE((
      SELECT COUNT(*)::INT FROM public.predictions p
      WHERE p.tournament_id = _tournament_id AND p.user_id = _user_id AND p.is_wildcard
    ), 0),
    stats_updated_at = now()
  WHERE tm.tournament_id = _tournament_id AND tm.user_id = _user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_pred_stats_for_match(_match_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.tournament_members tm
  SET
    pred_points = COALESCE(agg.pred_points, 0),
    correct_count = COALESCE(agg.correct_count, 0),
    exact_count = COALESCE(agg.exact_count, 0),
    predictions_made = COALESCE(agg.predictions_made, 0),
    wildcards_used = COALESCE(agg.wildcards_used, 0),
    stats_updated_at = now()
  FROM (
    SELECT
      p.tournament_id,
      p.user_id,
      COALESCE(SUM(p.points), 0)::INT AS pred_points,
      COUNT(*) FILTER (WHERE p.points > 0)::INT AS correct_count,
      COUNT(*) FILTER (WHERE p.exact)::INT AS exact_count,
      COUNT(*)::INT AS predictions_made,
      COUNT(*) FILTER (WHERE p.is_wildcard)::INT AS wildcards_used
    FROM public.predictions p
    WHERE (p.tournament_id, p.user_id) IN (
      SELECT DISTINCT tournament_id, user_id
      FROM public.predictions
      WHERE match_id = _match_id
    )
    GROUP BY p.tournament_id, p.user_id
  ) agg
  WHERE tm.tournament_id = agg.tournament_id
    AND tm.user_id = agg.user_id;
END;
$$;

-- Trigger only needs tournament meta columns now
DROP TRIGGER IF EXISTS trg_predictions_refresh_member_stats ON public.predictions;
CREATE TRIGGER trg_predictions_refresh_member_stats
  AFTER INSERT OR DELETE OR UPDATE OF
    is_wildcard, points, exact, tournament_id, user_id, match_id, pick_id
  ON public.predictions
  FOR EACH ROW EXECUTE FUNCTION public.trg_refresh_member_pred_stats();

-- -----------------------------------------------------------------------------
-- 8. Join paths attach existing shared picks
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.join_public_tournament(_tournament_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_public boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Autenticação necessária.';
  END IF;

  SELECT t.is_public INTO v_public
  FROM public.tournaments t
  WHERE t.id = _tournament_id;

  IF v_public IS NULL THEN
    RAISE EXCEPTION 'Torneio não encontrado.';
  END IF;

  IF NOT v_public THEN
    RAISE EXCEPTION 'Este torneio não é público. Usa o código de convite.';
  END IF;

  INSERT INTO public.tournament_members (tournament_id, user_id, role)
  VALUES (_tournament_id, v_uid, 'member')
  ON CONFLICT (tournament_id, user_id) DO NOTHING;

  PERFORM private.attach_existing_picks(_tournament_id, v_uid);

  RETURN _tournament_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.join_tournament_by_code(_code TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tid UUID;
  v_uid UUID := auth.uid();
  v_recent INT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Autenticação necessária.';
  END IF;

  SELECT COUNT(*)::INT INTO v_recent
  FROM private.join_code_attempts
  WHERE user_id = v_uid
    AND attempted_at > now() - interval '15 minutes';

  IF v_recent >= 20 THEN
    RAISE EXCEPTION 'Demasiadas tentativas. Espera alguns minutos e tenta de novo.';
  END IF;

  SELECT id INTO v_tid
  FROM public.tournaments
  WHERE join_code = upper(trim(_code));

  IF v_tid IS NULL THEN
    INSERT INTO private.join_code_attempts(user_id, success) VALUES (v_uid, false);
    RAISE EXCEPTION 'Torneio não encontrado.';
  END IF;

  INSERT INTO public.tournament_members (tournament_id, user_id, role)
  VALUES (v_tid, v_uid, 'member')
  ON CONFLICT DO NOTHING;

  INSERT INTO private.join_code_attempts(user_id, success) VALUES (v_uid, true);

  PERFORM private.attach_existing_picks(v_tid, v_uid);

  DELETE FROM private.join_code_attempts
  WHERE attempted_at < now() - interval '7 days';

  RETURN v_tid;
END;
$$;

-- Also in local migration file: admin read policy for picks
DROP POLICY IF EXISTS "user_match_picks select own" ON public.user_match_picks;
DROP POLICY IF EXISTS "user_match_picks select own or tournament admin" ON public.user_match_picks;
CREATE POLICY "user_match_picks select own or tournament admin"
  ON public.user_match_picks FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.matches m
      JOIN public.tournaments t ON t.competition_id = m.competition_id
      JOIN public.tournament_members tm
        ON tm.tournament_id = t.id AND tm.user_id = user_match_picks.user_id
      WHERE m.id = user_match_picks.match_id
        AND private.is_tournament_admin(t.id)
    )
  );
