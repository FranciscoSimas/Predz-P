
ALTER TABLE public.tournament_settings
  ADD COLUMN IF NOT EXISTS prizes_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS prize_entry_amount numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS prize_entry_currency text NOT NULL DEFAULT 'EUR',
  ADD COLUMN IF NOT EXISTS prize_pct_first integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS prize_pct_second integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS prize_pct_third integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS prize_custom jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.tournament_settings
  DROP CONSTRAINT IF EXISTS tournament_settings_prize_pcts_chk;
ALTER TABLE public.tournament_settings
  ADD CONSTRAINT tournament_settings_prize_pcts_chk
  CHECK (
    prize_pct_first BETWEEN 0 AND 100
    AND prize_pct_second BETWEEN 0 AND 100
    AND prize_pct_third BETWEEN 0 AND 100
    AND (prize_pct_first + prize_pct_second + prize_pct_third) <= 100
  );

ALTER TABLE public.tournament_settings
  DROP CONSTRAINT IF EXISTS tournament_settings_prize_entry_amount_chk;
ALTER TABLE public.tournament_settings
  ADD CONSTRAINT tournament_settings_prize_entry_amount_chk
  CHECK (prize_entry_amount >= 0 AND prize_entry_amount <= 100000);

-- Trigger: prizes only allowed on private, non-official tournaments
CREATE OR REPLACE FUNCTION public.enforce_prizes_private_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_public boolean;
  v_official boolean;
BEGIN
  IF NEW.prizes_enabled THEN
    SELECT is_public, is_official INTO v_public, v_official
    FROM public.tournaments WHERE id = NEW.tournament_id;
    IF COALESCE(v_public, false) OR COALESCE(v_official, false) THEN
      RAISE EXCEPTION 'Prémios só podem ser configurados em torneios privados e não-oficiais.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_prizes_private_only ON public.tournament_settings;
CREATE TRIGGER enforce_prizes_private_only
  BEFORE INSERT OR UPDATE ON public.tournament_settings
  FOR EACH ROW EXECUTE FUNCTION public.enforce_prizes_private_only();

-- Trigger on tournaments: when going public or official, wipe prize config
CREATE OR REPLACE FUNCTION public.clear_prizes_on_public()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (NEW.is_public AND NOT OLD.is_public) OR (NEW.is_official AND NOT OLD.is_official) THEN
    UPDATE public.tournament_settings
    SET prizes_enabled = false,
        prize_entry_amount = 0,
        prize_pct_first = 60,
        prize_pct_second = 30,
        prize_pct_third = 10,
        prize_custom = '[]'::jsonb,
        updated_at = now()
    WHERE tournament_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS clear_prizes_on_public ON public.tournaments;
CREATE TRIGGER clear_prizes_on_public
  AFTER UPDATE OF is_public, is_official ON public.tournaments
  FOR EACH ROW EXECUTE FUNCTION public.clear_prizes_on_public();
