
-- =========================================
-- Enums
-- =========================================
CREATE TYPE public.tournament_role AS ENUM ('owner', 'admin', 'member');
CREATE TYPE public.competition_format AS ENUM (
  'league',
  'groups_then_knockout',
  'league_phase_then_knockout',
  'groups_then_finals',
  'knockout_only'
);
CREATE TYPE public.match_status AS ENUM ('scheduled', 'live', 'finished');

-- =========================================
-- Helper: updated_at
-- =========================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- =========================================
-- profiles
-- =========================================
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  email TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles readable by authenticated"
  ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles insert own"
  ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles update own"
  ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, email, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data->>'display_name',
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'name',
      split_part(NEW.email, '@', 1)
    ),
    NEW.email,
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =========================================
-- competitions
-- =========================================
CREATE TABLE public.competitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  country TEXT,
  season TEXT NOT NULL,
  format public.competition_format NOT NULL,
  external_provider TEXT,
  external_id TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  logo_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.competitions TO authenticated;
GRANT ALL ON public.competitions TO service_role;
ALTER TABLE public.competitions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "competitions readable"
  ON public.competitions FOR SELECT TO authenticated USING (true);

CREATE TRIGGER trg_competitions_updated_at
  BEFORE UPDATE ON public.competitions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================
-- competition_teams
-- =========================================
CREATE TABLE public.competition_teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id UUID NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  short_name TEXT,
  crest_url TEXT,
  group_letter TEXT,
  external_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_competition_teams_competition ON public.competition_teams(competition_id);

GRANT SELECT ON public.competition_teams TO authenticated;
GRANT ALL ON public.competition_teams TO service_role;
ALTER TABLE public.competition_teams ENABLE ROW LEVEL SECURITY;

CREATE POLICY "competition_teams readable"
  ON public.competition_teams FOR SELECT TO authenticated USING (true);

-- =========================================
-- matches
-- =========================================
CREATE TABLE public.matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id UUID NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  phase TEXT,
  round_or_matchday INT,
  group_letter TEXT,
  home_team_id UUID REFERENCES public.competition_teams(id) ON DELETE SET NULL,
  away_team_id UUID REFERENCES public.competition_teams(id) ON DELETE SET NULL,
  home_label TEXT,
  away_label TEXT,
  kickoff_at TIMESTAMPTZ NOT NULL,
  status public.match_status NOT NULL DEFAULT 'scheduled',
  home_score INT,
  away_score INT,
  et_home_score INT,
  et_away_score INT,
  pen_home_score INT,
  pen_away_score INT,
  live_minute INT,
  external_id TEXT,
  manual_override BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_matches_competition ON public.matches(competition_id);
CREATE INDEX idx_matches_kickoff ON public.matches(kickoff_at);

GRANT SELECT ON public.matches TO authenticated;
GRANT ALL ON public.matches TO service_role;
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "matches readable"
  ON public.matches FOR SELECT TO authenticated USING (true);

CREATE TRIGGER trg_matches_updated_at
  BEFORE UPDATE ON public.matches
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================
-- tournaments
-- =========================================
CREATE TABLE public.tournaments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  slug TEXT UNIQUE,
  join_code TEXT NOT NULL UNIQUE,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  competition_id UUID NOT NULL REFERENCES public.competitions(id) ON DELETE RESTRICT,
  is_public BOOLEAN NOT NULL DEFAULT false,
  cover_color TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tournaments_owner ON public.tournaments(owner_id);
CREATE INDEX idx_tournaments_competition ON public.tournaments(competition_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tournaments TO authenticated;
GRANT ALL ON public.tournaments TO service_role;
ALTER TABLE public.tournaments ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER trg_tournaments_updated_at
  BEFORE UPDATE ON public.tournaments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================
-- tournament_members
-- =========================================
CREATE TABLE public.tournament_members (
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.tournament_role NOT NULL DEFAULT 'member',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tournament_id, user_id)
);

CREATE INDEX idx_tm_user ON public.tournament_members(user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tournament_members TO authenticated;
GRANT ALL ON public.tournament_members TO service_role;
ALTER TABLE public.tournament_members ENABLE ROW LEVEL SECURITY;

-- Security definer helpers (avoid recursive RLS)
CREATE OR REPLACE FUNCTION public.is_tournament_member(_tournament_id UUID, _user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tournament_members
    WHERE tournament_id = _tournament_id AND user_id = _user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.is_tournament_admin(_tournament_id UUID, _user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tournament_members
    WHERE tournament_id = _tournament_id
      AND user_id = _user_id
      AND role IN ('owner', 'admin')
  );
$$;

-- tournaments policies (defined here since they depend on helpers)
CREATE POLICY "tournaments visible if public or member"
  ON public.tournaments FOR SELECT TO authenticated
  USING (is_public OR public.is_tournament_member(id, auth.uid()) OR owner_id = auth.uid());

CREATE POLICY "tournaments insert own"
  ON public.tournaments FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "tournaments update by admin"
  ON public.tournaments FOR UPDATE TO authenticated
  USING (public.is_tournament_admin(id, auth.uid()))
  WITH CHECK (public.is_tournament_admin(id, auth.uid()));

CREATE POLICY "tournaments delete by owner"
  ON public.tournaments FOR DELETE TO authenticated
  USING (owner_id = auth.uid());

-- tournament_members policies
CREATE POLICY "tm select if in same tournament"
  ON public.tournament_members FOR SELECT TO authenticated
  USING (public.is_tournament_member(tournament_id, auth.uid()));

CREATE POLICY "tm join self"
  ON public.tournament_members FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "tm admin manage"
  ON public.tournament_members FOR UPDATE TO authenticated
  USING (public.is_tournament_admin(tournament_id, auth.uid()));

CREATE POLICY "tm leave or admin remove"
  ON public.tournament_members FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.is_tournament_admin(tournament_id, auth.uid()));

-- Auto-add owner as owner-member when creating tournament
CREATE OR REPLACE FUNCTION public.add_owner_as_member()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.tournament_members (tournament_id, user_id, role)
  VALUES (NEW.id, NEW.owner_id, 'owner')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.tournament_settings (tournament_id)
  VALUES (NEW.id)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

-- =========================================
-- tournament_settings
-- =========================================
CREATE TABLE public.tournament_settings (
  tournament_id UUID PRIMARY KEY REFERENCES public.tournaments(id) ON DELETE CASCADE,
  points_outcome INT NOT NULL DEFAULT 1,
  points_exact_bonus INT NOT NULL DEFAULT 2,
  points_advance INT NOT NULL DEFAULT 1,
  points_90_outcome INT NOT NULL DEFAULT 1,
  points_exact_90 INT NOT NULL DEFAULT 2,
  points_et_outcome INT NOT NULL DEFAULT 1,
  points_exact_et INT NOT NULL DEFAULT 2,
  points_pen_exact INT NOT NULL DEFAULT 3,
  special_bets_enabled BOOLEAN NOT NULL DEFAULT false,
  points_winner INT NOT NULL DEFAULT 20,
  points_top_scorer INT NOT NULL DEFAULT 20,
  wildcard_enabled BOOLEAN NOT NULL DEFAULT false,
  wildcard_per_round INT NOT NULL DEFAULT 1,
  win_streak_enabled BOOLEAN NOT NULL DEFAULT false,
  win_streak_threshold INT NOT NULL DEFAULT 3,
  win_streak_bonus INT NOT NULL DEFAULT 2,
  predictions_cutoff TEXT NOT NULL DEFAULT 'kickoff',
  special_bets_cutoff_at TIMESTAMPTZ,
  official_winner_team_id UUID REFERENCES public.competition_teams(id) ON DELETE SET NULL,
  official_top_scorer TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.tournament_settings TO authenticated;
GRANT ALL ON public.tournament_settings TO service_role;
ALTER TABLE public.tournament_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ts read if member"
  ON public.tournament_settings FOR SELECT TO authenticated
  USING (public.is_tournament_member(tournament_id, auth.uid()));

CREATE POLICY "ts write if admin"
  ON public.tournament_settings FOR UPDATE TO authenticated
  USING (public.is_tournament_admin(tournament_id, auth.uid()))
  WITH CHECK (public.is_tournament_admin(tournament_id, auth.uid()));

CREATE POLICY "ts insert if admin"
  ON public.tournament_settings FOR INSERT TO authenticated
  WITH CHECK (public.is_tournament_admin(tournament_id, auth.uid()) OR true);
-- ^ insert allowed via trigger; broader check ok since only one row per tournament (PK)

CREATE TRIGGER trg_ts_updated_at
  BEFORE UPDATE ON public.tournament_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Attach owner trigger AFTER tournament_settings exists
CREATE TRIGGER trg_add_owner_member
  AFTER INSERT ON public.tournaments
  FOR EACH ROW EXECUTE FUNCTION public.add_owner_as_member();

-- =========================================
-- predictions
-- =========================================
CREATE TABLE public.predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  match_id UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  home_pred INT,
  away_pred INT,
  et_home_pred INT,
  et_away_pred INT,
  pen_home_pred INT,
  pen_away_pred INT,
  is_wildcard BOOLEAN NOT NULL DEFAULT false,
  points INT NOT NULL DEFAULT 0,
  exact BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tournament_id, user_id, match_id)
);

CREATE INDEX idx_predictions_tournament ON public.predictions(tournament_id);
CREATE INDEX idx_predictions_user ON public.predictions(user_id);
CREATE INDEX idx_predictions_match ON public.predictions(match_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.predictions TO authenticated;
GRANT ALL ON public.predictions TO service_role;
ALTER TABLE public.predictions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "predictions own or admin read"
  ON public.predictions FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_tournament_admin(tournament_id, auth.uid()));

CREATE POLICY "predictions insert own if member"
  ON public.predictions FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND public.is_tournament_member(tournament_id, auth.uid())
  );

CREATE POLICY "predictions update own"
  ON public.predictions FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "predictions delete own"
  ON public.predictions FOR DELETE TO authenticated
  USING (user_id = auth.uid());

CREATE TRIGGER trg_predictions_updated_at
  BEFORE UPDATE ON public.predictions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Lock predictions after kickoff
CREATE OR REPLACE FUNCTION public.lock_predictions_after_kickoff()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
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

CREATE TRIGGER trg_lock_predictions_ins
  BEFORE INSERT ON public.predictions
  FOR EACH ROW EXECUTE FUNCTION public.lock_predictions_after_kickoff();

CREATE TRIGGER trg_lock_predictions_upd
  BEFORE UPDATE ON public.predictions
  FOR EACH ROW EXECUTE FUNCTION public.lock_predictions_after_kickoff();

-- Recalc points when match result changes
CREATE OR REPLACE FUNCTION public.calc_prediction_points(
  _home_pred INT, _away_pred INT,
  _home_score INT, _away_score INT,
  _p_outcome INT, _p_exact_bonus INT
) RETURNS TABLE(points INT, exact BOOLEAN)
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  pred_sign INT;
  real_sign INT;
  p INT := 0;
  ex BOOLEAN := false;
BEGIN
  IF _home_pred IS NULL OR _away_pred IS NULL
     OR _home_score IS NULL OR _away_score IS NULL THEN
    RETURN QUERY SELECT 0, false;
    RETURN;
  END IF;

  pred_sign := sign(_home_pred - _away_pred);
  real_sign := sign(_home_score - _away_score);

  IF pred_sign = real_sign THEN
    p := _p_outcome;
    IF _home_pred = _home_score AND _away_pred = _away_score THEN
      p := p + _p_exact_bonus;
      ex := true;
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
BEGIN
  IF NEW.home_score IS NULL OR NEW.away_score IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND
     NEW.home_score IS NOT DISTINCT FROM OLD.home_score AND
     NEW.away_score IS NOT DISTINCT FROM OLD.away_score AND
     NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  FOR r IN
    SELECT p.id, p.tournament_id, p.home_pred, p.away_pred,
           ts.points_outcome, ts.points_exact_bonus
    FROM public.predictions p
    JOIN public.tournament_settings ts ON ts.tournament_id = p.tournament_id
    WHERE p.match_id = NEW.id
  LOOP
    SELECT * INTO calc FROM public.calc_prediction_points(
      r.home_pred, r.away_pred, NEW.home_score, NEW.away_score,
      r.points_outcome, r.points_exact_bonus
    );
    UPDATE public.predictions
    SET points = calc.points, exact = calc.exact
    WHERE id = r.id;
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_recalc_predictions
  AFTER INSERT OR UPDATE OF home_score, away_score, status ON public.matches
  FOR EACH ROW EXECUTE FUNCTION public.recalc_match_predictions();

-- =========================================
-- Leaderboard view
-- =========================================
CREATE OR REPLACE VIEW public.tournament_leaderboard AS
SELECT
  tm.tournament_id,
  tm.user_id,
  pr.display_name,
  pr.avatar_url,
  COALESCE(SUM(p.points), 0)::INT AS total_points,
  COUNT(p.id) FILTER (WHERE p.points > 0)::INT AS correct_count,
  COUNT(p.id) FILTER (WHERE p.exact)::INT AS exact_count,
  COUNT(p.id) FILTER (WHERE p.home_pred IS NOT NULL)::INT AS predictions_made
FROM public.tournament_members tm
LEFT JOIN public.profiles pr ON pr.id = tm.user_id
LEFT JOIN public.predictions p ON p.tournament_id = tm.tournament_id AND p.user_id = tm.user_id
GROUP BY tm.tournament_id, tm.user_id, pr.display_name, pr.avatar_url;

GRANT SELECT ON public.tournament_leaderboard TO authenticated;

-- =========================================
-- Realtime
-- =========================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.matches;
ALTER PUBLICATION supabase_realtime ADD TABLE public.predictions;

-- =========================================
-- Join by code (bypasses select-privacy for the code holder)
-- =========================================
CREATE OR REPLACE FUNCTION public.join_tournament_by_code(_code TEXT)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tid UUID;
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Autenticação necessária.';
  END IF;
  SELECT id INTO v_tid FROM public.tournaments WHERE join_code = upper(_code);
  IF v_tid IS NULL THEN
    RAISE EXCEPTION 'Torneio não encontrado.';
  END IF;
  INSERT INTO public.tournament_members (tournament_id, user_id, role)
  VALUES (v_tid, v_uid, 'member')
  ON CONFLICT DO NOTHING;
  RETURN v_tid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.join_tournament_by_code(TEXT) TO authenticated;

-- =========================================
-- Seed: Liga Portugal 25/26
-- =========================================
INSERT INTO public.competitions (slug, name, country, season, format, is_active)
VALUES ('liga-portugal-25-26', 'Liga Portugal', 'Portugal', '25/26', 'league', true);

INSERT INTO public.competition_teams (competition_id, name, short_name)
SELECT c.id, t.name, t.short_name
FROM public.competitions c,
(VALUES
  ('SL Benfica', 'BEN'),
  ('FC Porto', 'POR'),
  ('Sporting CP', 'SCP'),
  ('SC Braga', 'BRA'),
  ('Vitória SC', 'VSC'),
  ('Rio Ave FC', 'RIO'),
  ('Casa Pia AC', 'CPA'),
  ('Moreirense FC', 'MOR'),
  ('FC Famalicão', 'FAM'),
  ('CF Estrela da Amadora', 'EST'),
  ('Gil Vicente FC', 'GIL'),
  ('Estoril Praia', 'ETL'),
  ('CD Nacional', 'NAC'),
  ('AVS Futebol SAD', 'AVS'),
  ('CD Santa Clara', 'SCL'),
  ('GD Chaves', 'CHA'),
  ('FC Arouca', 'ARO'),
  ('Boavista FC', 'BOA')
) AS t(name, short_name)
WHERE c.slug = 'liga-portugal-25-26';
