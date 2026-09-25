-- Allow tournament admins to delete non-official tournaments;
-- official tournaments remain platform-admin only.
DROP POLICY IF EXISTS "tournaments delete by owner" ON public.tournaments;
CREATE POLICY "tournaments delete by admins"
  ON public.tournaments FOR DELETE TO authenticated
  USING (
    CASE WHEN is_official
      THEN private.is_platform_admin()
      ELSE private.is_tournament_admin(id)
    END
  );

-- Never allow the owner's membership row to be removed, including self-removal.
DROP POLICY IF EXISTS "tm leave or admin remove" ON public.tournament_members;
CREATE POLICY "tm leave or admin remove"
  ON public.tournament_members FOR DELETE TO authenticated
  USING (
    (user_id = (SELECT auth.uid()) OR private.is_tournament_admin(tournament_id))
    AND NOT EXISTS (
      SELECT 1 FROM public.tournaments t
      WHERE t.id = tournament_id AND t.owner_id = user_id
    )
  );

CREATE TABLE public.competition_standing_zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id uuid NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  position_from integer NOT NULL CHECK (position_from > 0),
  position_to integer NOT NULL CHECK (position_to >= position_from),
  zone_key text NOT NULL CHECK (zone_key IN (
    'champions_league','champions_league_qualifying','europa_league','europa_league_qualifying',
    'conference_league','conference_league_qualifying','libertadores','libertadores_qualifying',
    'sudamericana','promotion','promotion_playoff','round_of_16','knockout_playoff',
    'relegation_playoff','relegation','eliminated'
  )),
  label_pt text NOT NULL,
  label_en text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (competition_id, position_from, position_to, zone_key)
);

CREATE INDEX idx_competition_standing_zones_competition
  ON public.competition_standing_zones(competition_id, position_from);

ALTER TABLE public.competition_standing_zones ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.competition_standing_zones TO authenticated;
GRANT ALL ON public.competition_standing_zones TO service_role;

CREATE POLICY "standing zones readable"
  ON public.competition_standing_zones FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "standing zones platform admin insert"
  ON public.competition_standing_zones FOR INSERT TO authenticated
  WITH CHECK (private.is_platform_admin());
CREATE POLICY "standing zones platform admin update"
  ON public.competition_standing_zones FOR UPDATE TO authenticated
  USING (private.is_platform_admin()) WITH CHECK (private.is_platform_admin());
CREATE POLICY "standing zones platform admin delete"
  ON public.competition_standing_zones FOR DELETE TO authenticated
  USING (private.is_platform_admin());

WITH zone_data(provider, code, p_from, p_to, zone_key, label_pt, label_en, sort_order) AS (
  VALUES
  ('football-data','PPL',1,1,'champions_league','Fase de liga da Champions League','Champions League league phase',10),
  ('football-data','PPL',2,2,'champions_league_qualifying','Qualificação para a Champions League','Champions League qualifying',20),
  ('football-data','PPL',3,3,'europa_league_qualifying','Qualificação para a Europa League','Europa League qualifying',30),
  ('football-data','PPL',4,4,'conference_league_qualifying','Qualificação para a Conference League','Conference League qualifying',40),
  ('football-data','PPL',16,16,'relegation_playoff','Play-off de despromoção','Relegation play-off',90),
  ('football-data','PPL',17,18,'relegation','Despromoção','Relegation',100),

  ('football-data','PL',1,4,'champions_league','Fase de liga da Champions League','Champions League league phase',10),
  ('football-data','PL',5,5,'europa_league','Fase de liga da Europa League','Europa League league phase',20),
  ('football-data','PL',6,6,'conference_league_qualifying','Qualificação para a Conference League','Conference League qualifying',30),
  ('football-data','PL',18,20,'relegation','Despromoção','Relegation',100),

  ('football-data','BL1',1,4,'champions_league','Fase de liga da Champions League','Champions League league phase',10),
  ('football-data','BL1',5,5,'europa_league','Fase de liga da Europa League','Europa League league phase',20),
  ('football-data','BL1',6,6,'conference_league_qualifying','Play-off da Conference League','Conference League play-off',30),
  ('football-data','BL1',16,16,'relegation_playoff','Play-off de despromoção','Relegation play-off',90),
  ('football-data','BL1',17,18,'relegation','Despromoção','Relegation',100),

  ('football-data','SA',1,4,'champions_league','Fase de liga da Champions League','Champions League league phase',10),
  ('football-data','SA',5,5,'europa_league','Fase de liga da Europa League','Europa League league phase',20),
  ('football-data','SA',6,6,'conference_league_qualifying','Play-off da Conference League','Conference League play-off',30),
  ('football-data','SA',18,20,'relegation','Despromoção','Relegation',100),

  ('football-data','PD',1,4,'champions_league','Fase de liga da Champions League','Champions League league phase',10),
  ('football-data','PD',5,5,'europa_league','Fase de liga da Europa League','Europa League league phase',20),
  ('football-data','PD',6,6,'conference_league_qualifying','Play-off da Conference League','Conference League play-off',30),
  ('football-data','PD',18,20,'relegation','Despromoção','Relegation',100),

  ('football-data','FL1',1,3,'champions_league','Fase de liga da Champions League','Champions League league phase',10),
  ('football-data','FL1',4,4,'champions_league_qualifying','Qualificação para a Champions League','Champions League qualifying',20),
  ('football-data','FL1',5,5,'europa_league','Fase de liga da Europa League','Europa League league phase',30),
  ('football-data','FL1',6,6,'conference_league_qualifying','Play-off da Conference League','Conference League play-off',40),
  ('football-data','FL1',16,16,'relegation_playoff','Play-off de despromoção','Relegation play-off',90),
  ('football-data','FL1',17,18,'relegation','Despromoção','Relegation',100),

  ('football-data','DED',1,1,'champions_league','Fase de liga da Champions League','Champions League league phase',10),
  ('football-data','DED',2,2,'champions_league_qualifying','Qualificação para a Champions League','Champions League qualifying',20),
  ('football-data','DED',3,3,'europa_league_qualifying','Qualificação para a Europa League','Europa League qualifying',30),
  ('football-data','DED',4,7,'conference_league_qualifying','Play-off europeu para a Conference League','European play-offs for Conference League',40),
  ('football-data','DED',16,16,'relegation_playoff','Play-off de despromoção','Relegation play-off',90),
  ('football-data','DED',17,18,'relegation','Despromoção','Relegation',100),

  ('football-data','ELC',1,2,'promotion','Promoção direta à Premier League','Automatic promotion to Premier League',10),
  ('football-data','ELC',3,8,'promotion_playoff','Play-off de promoção','Promotion play-offs',20),
  ('football-data','ELC',22,24,'relegation','Despromoção','Relegation',100),

  ('football-data','BSA',1,4,'libertadores','Fase de grupos da Libertadores','Copa Libertadores group stage',10),
  ('football-data','BSA',5,5,'libertadores_qualifying','Pré-Libertadores','Copa Libertadores qualifying',20),
  ('football-data','BSA',6,11,'sudamericana','Copa Sudamericana','Copa Sudamericana',30),
  ('football-data','BSA',17,20,'relegation','Despromoção','Relegation',100),

  ('football-data','CL',1,8,'round_of_16','Apuramento direto para os oitavos de final','Direct qualification for round of 16',10),
  ('football-data','CL',9,24,'knockout_playoff','Play-off da fase a eliminar','Knockout phase play-off',20),
  ('football-data','CL',25,36,'eliminated','Eliminado','Eliminated',100),

  ('api-football','3',1,8,'round_of_16','Apuramento direto para os oitavos de final','Direct qualification for round of 16',10),
  ('api-football','3',9,24,'knockout_playoff','Play-off da fase a eliminar','Knockout phase play-off',20),
  ('api-football','3',25,36,'eliminated','Eliminado','Eliminated',100)
)
INSERT INTO public.competition_standing_zones (
  competition_id, position_from, position_to, zone_key, label_pt, label_en, sort_order
)
SELECT c.id, z.p_from, z.p_to, z.zone_key, z.label_pt, z.label_en, z.sort_order
FROM zone_data z
JOIN public.competitions c
  ON c.external_provider = z.provider AND c.external_id = z.code
ON CONFLICT (competition_id, position_from, position_to, zone_key)
DO UPDATE SET
  label_pt = EXCLUDED.label_pt,
  label_en = EXCLUDED.label_en,
  sort_order = EXCLUDED.sort_order;
