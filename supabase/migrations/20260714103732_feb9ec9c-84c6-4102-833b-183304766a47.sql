
DROP VIEW IF EXISTS public.tournament_leaderboard;
DROP FUNCTION IF EXISTS private.current_user_leaderboard();

-- ============================================================
-- 1. tournament_settings: novos campos
-- ============================================================
ALTER TABLE public.tournament_settings
  ADD COLUMN IF NOT EXISTS wildcard_multiplier INT NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS wildcard_scope TEXT NOT NULL DEFAULT 'per_matchday'
    CHECK (wildcard_scope IN ('per_matchday','per_season')),
  ADD COLUMN IF NOT EXISTS win_streak_mode TEXT NOT NULL DEFAULT 'bonus_points'
    CHECK (win_streak_mode IN ('bonus_points','multiplier')),
  ADD COLUMN IF NOT EXISTS special_bet_winner_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS special_bet_top_scorer_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS special_bet_best_defense_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS points_best_defense INT NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS top_scorer_mode TEXT NOT NULL DEFAULT 'player_match'
    CHECK (top_scorer_mode IN ('player_match','per_goal')),
  ADD COLUMN IF NOT EXISTS points_top_scorer_per_goal INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS winner_points_mode TEXT NOT NULL DEFAULT 'final_only'
    CHECK (winner_points_mode IN ('final_only','per_phase')),
  ADD COLUMN IF NOT EXISTS points_winner_group INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS points_winner_r16 INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS points_winner_quarter INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS points_winner_semi INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS points_winner_final INT NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS official_best_defense_team_id UUID
    REFERENCES public.competition_teams(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS official_top_scorer_goals INT;

-- ============================================================
-- 2. competitions: default_settings
-- ============================================================
ALTER TABLE public.competitions
  ADD COLUMN IF NOT EXISTS default_settings JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.competitions
SET default_settings = '{
  "points_outcome": 1,
  "points_exact_bonus": 2,
  "wildcard_enabled": true,
  "wildcard_per_round": 1,
  "wildcard_multiplier": 2,
  "wildcard_scope": "per_matchday",
  "win_streak_enabled": true,
  "win_streak_threshold": 3,
  "win_streak_bonus": 2,
  "win_streak_mode": "bonus_points",
  "special_bets_enabled": true,
  "special_bet_winner_enabled": true,
  "special_bet_top_scorer_enabled": true,
  "special_bet_best_defense_enabled": true,
  "points_winner": 20,
  "points_top_scorer": 20,
  "points_best_defense": 15,
  "top_scorer_mode": "player_match"
}'::jsonb
WHERE slug = 'liga-portugal';

-- ============================================================
-- 3. special_bets
-- ============================================================
DO $$ BEGIN
  CREATE TYPE public.special_bet_type AS ENUM ('winner','top_scorer','best_defense');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.special_bets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bet_type public.special_bet_type NOT NULL,
  value TEXT NOT NULL,
  team_id UUID REFERENCES public.competition_teams(id) ON DELETE SET NULL,
  points INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tournament_id, user_id, bet_type)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.special_bets TO authenticated;
GRANT ALL ON public.special_bets TO service_role;
ALTER TABLE public.special_bets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "special_bets select member" ON public.special_bets;
CREATE POLICY "special_bets select member"
  ON public.special_bets FOR SELECT TO authenticated
  USING (private.is_tournament_member(tournament_id));

DROP POLICY IF EXISTS "special_bets insert own" ON public.special_bets;
CREATE POLICY "special_bets insert own"
  ON public.special_bets FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND private.is_tournament_member(tournament_id)
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
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
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
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.tournament_settings ts
      WHERE ts.tournament_id = special_bets.tournament_id
        AND (ts.special_bets_cutoff_at IS NULL OR ts.special_bets_cutoff_at > now())
    )
  );

DROP TRIGGER IF EXISTS special_bets_set_updated_at ON public.special_bets;
CREATE TRIGGER special_bets_set_updated_at
  BEFORE UPDATE ON public.special_bets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- 4. tournament_member_streaks
-- ============================================================
CREATE TABLE IF NOT EXISTS public.tournament_member_streaks (
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  current_streak INT NOT NULL DEFAULT 0,
  best_streak INT NOT NULL DEFAULT 0,
  bonus_points INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tournament_id, user_id)
);

GRANT SELECT ON public.tournament_member_streaks TO authenticated;
GRANT ALL ON public.tournament_member_streaks TO service_role;
ALTER TABLE public.tournament_member_streaks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "streaks select member" ON public.tournament_member_streaks;
CREATE POLICY "streaks select member"
  ON public.tournament_member_streaks FOR SELECT TO authenticated
  USING (private.is_tournament_member(tournament_id));

-- ============================================================
-- 5. add_owner_as_member: merge de defaults da competição
-- ============================================================
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

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_add_owner_as_member ON public.tournaments;
CREATE TRIGGER trg_add_owner_as_member
  AFTER INSERT ON public.tournaments
  FOR EACH ROW EXECUTE FUNCTION public.add_owner_as_member();

-- ============================================================
-- 6. Win streak recalc
-- ============================================================
CREATE OR REPLACE FUNCTION public.recalc_tournament_streaks(_tournament_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s RECORD; u RECORD;
  cur INT; best INT; bonus INT;
  v_threshold INT; v_bonus INT; v_enabled BOOLEAN;
BEGIN
  SELECT win_streak_enabled, win_streak_threshold, win_streak_bonus
  INTO v_enabled, v_threshold, v_bonus
  FROM public.tournament_settings WHERE tournament_id = _tournament_id;

  IF NOT COALESCE(v_enabled, false) THEN
    UPDATE public.tournament_member_streaks
    SET current_streak = 0, bonus_points = 0, updated_at = now()
    WHERE tournament_id = _tournament_id;
    RETURN;
  END IF;

  FOR u IN SELECT DISTINCT user_id FROM public.tournament_members WHERE tournament_id = _tournament_id LOOP
    cur := 0; best := 0; bonus := 0;
    FOR s IN
      SELECT p.points
      FROM public.predictions p
      JOIN public.matches m ON m.id = p.match_id
      WHERE p.tournament_id = _tournament_id
        AND p.user_id = u.user_id
        AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL
      ORDER BY m.kickoff_at
    LOOP
      IF s.points > 0 THEN
        cur := cur + 1;
        IF cur > best THEN best := cur; END IF;
        IF cur > 0 AND v_threshold > 0 AND cur % v_threshold = 0 THEN
          bonus := bonus + v_bonus;
        END IF;
      ELSE
        cur := 0;
      END IF;
    END LOOP;
    INSERT INTO public.tournament_member_streaks(tournament_id, user_id, current_streak, best_streak, bonus_points, updated_at)
    VALUES (_tournament_id, u.user_id, cur, best, bonus, now())
    ON CONFLICT (tournament_id, user_id) DO UPDATE
    SET current_streak = EXCLUDED.current_streak,
        best_streak = GREATEST(public.tournament_member_streaks.best_streak, EXCLUDED.best_streak),
        bonus_points = EXCLUDED.bonus_points,
        updated_at = now();
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.recalc_tournament_streaks(UUID) FROM anon, authenticated;

-- ============================================================
-- 7. recalc_match_predictions: wildcard multiplier + streaks
-- ============================================================
CREATE OR REPLACE FUNCTION public.recalc_match_predictions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD; calc RECORD; v_points INT;
  t RECORD;
BEGIN
  IF NEW.home_score IS NULL OR NEW.away_score IS NULL THEN RETURN NEW; END IF;

  IF TG_OP = 'UPDATE' AND
     NEW.home_score IS NOT DISTINCT FROM OLD.home_score AND
     NEW.away_score IS NOT DISTINCT FROM OLD.away_score AND
     NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  FOR r IN
    SELECT p.id, p.tournament_id, p.home_pred, p.away_pred, p.is_wildcard,
           ts.points_outcome, ts.points_exact_bonus,
           ts.wildcard_enabled, ts.wildcard_multiplier
    FROM public.predictions p
    JOIN public.tournament_settings ts ON ts.tournament_id = p.tournament_id
    WHERE p.match_id = NEW.id
  LOOP
    SELECT * INTO calc FROM public.calc_prediction_points(
      r.home_pred, r.away_pred, NEW.home_score, NEW.away_score,
      r.points_outcome, r.points_exact_bonus
    );
    v_points := calc.points;
    IF r.is_wildcard AND r.wildcard_enabled AND v_points > 0 THEN
      v_points := v_points * GREATEST(r.wildcard_multiplier, 1);
    END IF;
    UPDATE public.predictions SET points = v_points, exact = calc.exact WHERE id = r.id;
  END LOOP;

  FOR t IN SELECT id FROM public.tournaments WHERE competition_id = NEW.competition_id LOOP
    PERFORM public.recalc_tournament_streaks(t.id);
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_recalc_match_predictions ON public.matches;
CREATE TRIGGER trg_recalc_match_predictions
  AFTER INSERT OR UPDATE OF home_score, away_score, status ON public.matches
  FOR EACH ROW EXECUTE FUNCTION public.recalc_match_predictions();

-- ============================================================
-- 8. Wildcard validation + lock + updated_at triggers
-- ============================================================
CREATE OR REPLACE FUNCTION public.validate_wildcard_prediction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enabled BOOLEAN; v_per_round INT; v_scope TEXT; v_matchday INT; v_used INT;
BEGIN
  IF NOT COALESCE(NEW.is_wildcard, false) THEN RETURN NEW; END IF;

  SELECT wildcard_enabled, wildcard_per_round, wildcard_scope
    INTO v_enabled, v_per_round, v_scope
  FROM public.tournament_settings WHERE tournament_id = NEW.tournament_id;

  IF NOT COALESCE(v_enabled, false) THEN
    RAISE EXCEPTION 'Wildcard não está ativo neste torneio.';
  END IF;

  SELECT round_or_matchday INTO v_matchday FROM public.matches WHERE id = NEW.match_id;

  IF v_scope = 'per_season' THEN
    SELECT COUNT(*) INTO v_used
    FROM public.predictions
    WHERE tournament_id = NEW.tournament_id AND user_id = NEW.user_id
      AND is_wildcard = true AND (TG_OP = 'INSERT' OR id <> NEW.id);
  ELSE
    SELECT COUNT(*) INTO v_used
    FROM public.predictions p
    JOIN public.matches m ON m.id = p.match_id
    WHERE p.tournament_id = NEW.tournament_id AND p.user_id = NEW.user_id
      AND p.is_wildcard = true AND m.round_or_matchday = v_matchday
      AND (TG_OP = 'INSERT' OR p.id <> NEW.id);
  END IF;

  IF v_used >= COALESCE(v_per_round, 1) THEN
    RAISE EXCEPTION 'Limite de wildcards atingido.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_wildcard ON public.predictions;
CREATE TRIGGER trg_validate_wildcard
  BEFORE INSERT OR UPDATE OF is_wildcard ON public.predictions
  FOR EACH ROW EXECUTE FUNCTION public.validate_wildcard_prediction();

DROP TRIGGER IF EXISTS trg_lock_predictions ON public.predictions;
CREATE TRIGGER trg_lock_predictions
  BEFORE INSERT OR UPDATE ON public.predictions
  FOR EACH ROW EXECUTE FUNCTION public.lock_predictions_after_kickoff();

DROP TRIGGER IF EXISTS trg_predictions_updated_at ON public.predictions;
CREATE TRIGGER trg_predictions_updated_at
  BEFORE UPDATE ON public.predictions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_tournament_settings_updated_at ON public.tournament_settings;
CREATE TRIGGER trg_tournament_settings_updated_at
  BEFORE UPDATE ON public.tournament_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_matches_updated_at ON public.matches;
CREATE TRIGGER trg_matches_updated_at
  BEFORE UPDATE ON public.matches
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_tournaments_updated_at ON public.tournaments;
CREATE TRIGGER trg_tournaments_updated_at
  BEFORE UPDATE ON public.tournaments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- 9. Special bets recalc + trigger on settings update
-- ============================================================
CREATE OR REPLACE FUNCTION public.recalc_special_bets(_tournament_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE ts RECORD;
BEGIN
  SELECT * INTO ts FROM public.tournament_settings WHERE tournament_id = _tournament_id;
  IF NOT FOUND OR NOT COALESCE(ts.special_bets_enabled, false) THEN
    UPDATE public.special_bets SET points = 0, updated_at = now()
    WHERE tournament_id = _tournament_id;
    RETURN;
  END IF;

  UPDATE public.special_bets sb
  SET points = CASE
    WHEN ts.special_bet_winner_enabled AND ts.official_winner_team_id IS NOT NULL
      AND sb.team_id = ts.official_winner_team_id
    THEN COALESCE(ts.points_winner, 0) ELSE 0 END,
    updated_at = now()
  WHERE sb.tournament_id = _tournament_id AND sb.bet_type = 'winner';

  UPDATE public.special_bets sb
  SET points = CASE
    WHEN ts.special_bet_top_scorer_enabled AND ts.official_top_scorer IS NOT NULL
      AND lower(trim(sb.value)) = lower(trim(ts.official_top_scorer))
    THEN CASE WHEN ts.top_scorer_mode = 'per_goal'
      THEN COALESCE(ts.official_top_scorer_goals, 0) * COALESCE(ts.points_top_scorer_per_goal, 1)
      ELSE COALESCE(ts.points_top_scorer, 0) END
    ELSE 0 END,
    updated_at = now()
  WHERE sb.tournament_id = _tournament_id AND sb.bet_type = 'top_scorer';

  UPDATE public.special_bets sb
  SET points = CASE
    WHEN ts.special_bet_best_defense_enabled AND ts.official_best_defense_team_id IS NOT NULL
      AND sb.team_id = ts.official_best_defense_team_id
    THEN COALESCE(ts.points_best_defense, 0) ELSE 0 END,
    updated_at = now()
  WHERE sb.tournament_id = _tournament_id AND sb.bet_type = 'best_defense';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.recalc_special_bets(UUID) FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.tournament_settings_after_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.official_winner_team_id IS DISTINCT FROM OLD.official_winner_team_id
     OR NEW.official_top_scorer IS DISTINCT FROM OLD.official_top_scorer
     OR NEW.official_best_defense_team_id IS DISTINCT FROM OLD.official_best_defense_team_id
     OR NEW.official_top_scorer_goals IS DISTINCT FROM OLD.official_top_scorer_goals
     OR NEW.points_winner IS DISTINCT FROM OLD.points_winner
     OR NEW.points_top_scorer IS DISTINCT FROM OLD.points_top_scorer
     OR NEW.points_best_defense IS DISTINCT FROM OLD.points_best_defense
     OR NEW.special_bets_enabled IS DISTINCT FROM OLD.special_bets_enabled THEN
    PERFORM public.recalc_special_bets(NEW.tournament_id);
  END IF;

  IF NEW.win_streak_enabled IS DISTINCT FROM OLD.win_streak_enabled
     OR NEW.win_streak_threshold IS DISTINCT FROM OLD.win_streak_threshold
     OR NEW.win_streak_bonus IS DISTINCT FROM OLD.win_streak_bonus THEN
    PERFORM public.recalc_tournament_streaks(NEW.tournament_id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tournament_settings_after_update ON public.tournament_settings;
CREATE TRIGGER trg_tournament_settings_after_update
  AFTER UPDATE ON public.tournament_settings
  FOR EACH ROW EXECUTE FUNCTION public.tournament_settings_after_update();

-- ============================================================
-- 10. Leaderboard view (recreated with new columns)
-- ============================================================
CREATE OR REPLACE FUNCTION private.current_user_leaderboard()
RETURNS TABLE(
  tournament_id uuid, user_id uuid, display_name text, avatar_url text,
  total_points integer, correct_count integer, exact_count integer, predictions_made integer,
  special_bets_points integer, streak_bonus_points integer,
  current_streak integer, best_streak integer, wildcards_used integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
  SELECT
    tm.tournament_id, tm.user_id, pr.display_name, pr.avatar_url,
    (COALESCE(SUM(p.points),0)
      + COALESCE((SELECT SUM(sb.points) FROM public.special_bets sb
                  WHERE sb.tournament_id = tm.tournament_id AND sb.user_id = tm.user_id), 0)
      + COALESCE((SELECT s.bonus_points FROM public.tournament_member_streaks s
                  WHERE s.tournament_id = tm.tournament_id AND s.user_id = tm.user_id), 0)
    )::INT,
    COUNT(p.id) FILTER (WHERE p.points > 0)::INT,
    COUNT(p.id) FILTER (WHERE p.exact)::INT,
    COUNT(p.id) FILTER (WHERE p.home_pred IS NOT NULL)::INT,
    COALESCE((SELECT SUM(sb.points) FROM public.special_bets sb
              WHERE sb.tournament_id = tm.tournament_id AND sb.user_id = tm.user_id), 0)::INT,
    COALESCE((SELECT s.bonus_points FROM public.tournament_member_streaks s
              WHERE s.tournament_id = tm.tournament_id AND s.user_id = tm.user_id), 0)::INT,
    COALESCE((SELECT s.current_streak FROM public.tournament_member_streaks s
              WHERE s.tournament_id = tm.tournament_id AND s.user_id = tm.user_id), 0)::INT,
    COALESCE((SELECT s.best_streak FROM public.tournament_member_streaks s
              WHERE s.tournament_id = tm.tournament_id AND s.user_id = tm.user_id), 0)::INT,
    COUNT(p.id) FILTER (WHERE p.is_wildcard)::INT
  FROM public.tournament_members tm
  LEFT JOIN public.profiles pr ON pr.id = tm.user_id
  LEFT JOIN public.predictions p ON p.tournament_id = tm.tournament_id AND p.user_id = tm.user_id
  WHERE private.is_tournament_member(tm.tournament_id)
  GROUP BY tm.tournament_id, tm.user_id, pr.display_name, pr.avatar_url;
$$;

CREATE VIEW public.tournament_leaderboard
WITH (security_invoker = true)
AS SELECT * FROM private.current_user_leaderboard();

GRANT SELECT ON public.tournament_leaderboard TO authenticated;
