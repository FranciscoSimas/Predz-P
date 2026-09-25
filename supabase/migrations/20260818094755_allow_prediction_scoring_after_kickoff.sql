-- Daily/live scoring UPDATEs predictions.points after kickoff via
-- recalc_match_predictions. The pick-lock trigger used to block ALL prediction
-- writes after kickoff, so a match with existing picks could not receive a
-- result (P0001 "Prognóstico bloqueado"). Allow scoring-only updates from
-- service_role / postgres; keep locking pick identity and wildcards.

CREATE OR REPLACE FUNCTION public.lock_predictions_after_kickoff()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kickoff TIMESTAMPTZ;
  v_role TEXT;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.pick_id IS NOT DISTINCT FROM OLD.pick_id
     AND NEW.is_wildcard IS NOT DISTINCT FROM OLD.is_wildcard
     AND NEW.match_id IS NOT DISTINCT FROM OLD.match_id
     AND NEW.user_id IS NOT DISTINCT FROM OLD.user_id
     AND NEW.tournament_id IS NOT DISTINCT FROM OLD.tournament_id THEN
    v_role := COALESCE(auth.role(), '');
    IF v_role NOT IN ('authenticated', 'anon') THEN
      RETURN NEW;
    END IF;
  END IF;

  SELECT kickoff_at INTO v_kickoff FROM public.matches WHERE id = NEW.match_id;
  IF v_kickoff IS NOT NULL AND v_kickoff <= now() THEN
    RAISE EXCEPTION 'Prognóstico bloqueado: o jogo já começou.';
  END IF;
  RETURN NEW;
END;
$$;
