
-- 1. Add is_official
ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS is_official boolean NOT NULL DEFAULT false;

-- 2. Official implies public
ALTER TABLE public.tournaments
  DROP CONSTRAINT IF EXISTS tournaments_official_public_chk;
ALTER TABLE public.tournaments
  ADD CONSTRAINT tournaments_official_public_chk
  CHECK (NOT is_official OR is_public);

-- 3. Unique official per competition
CREATE UNIQUE INDEX IF NOT EXISTS tournaments_one_official_per_competition
  ON public.tournaments(competition_id)
  WHERE is_official;

-- 4. platform_admins table
CREATE TABLE IF NOT EXISTS public.platform_admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.platform_admins TO authenticated;
GRANT ALL ON public.platform_admins TO service_role;
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "platform_admins self read" ON public.platform_admins;
CREATE POLICY "platform_admins self read" ON public.platform_admins
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- 5. Helper is_platform_admin
CREATE OR REPLACE FUNCTION private.is_platform_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.platform_admins WHERE user_id = auth.uid()
  );
$$;
REVOKE ALL ON FUNCTION private.is_platform_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_platform_admin() TO authenticated, service_role;

-- 6. Tournaments RLS: block non-platform-admins from creating/editing/deleting official
DROP POLICY IF EXISTS "tournaments insert own" ON public.tournaments;
CREATE POLICY "tournaments insert own" ON public.tournaments
  FOR INSERT TO authenticated
  WITH CHECK (
    owner_id = auth.uid()
    AND (NOT is_official OR private.is_platform_admin())
  );

DROP POLICY IF EXISTS "tournaments update safe fields by admin" ON public.tournaments;
CREATE POLICY "tournaments update safe fields by admin" ON public.tournaments
  FOR UPDATE TO authenticated
  USING (
    CASE WHEN is_official
      THEN private.is_platform_admin()
      ELSE private.is_tournament_admin(id)
    END
  )
  WITH CHECK (
    CASE WHEN is_official
      THEN private.is_platform_admin()
      ELSE private.is_tournament_admin(id)
    END
  );

DROP POLICY IF EXISTS "tournaments delete by owner" ON public.tournaments;
CREATE POLICY "tournaments delete by owner" ON public.tournaments
  FOR DELETE TO authenticated
  USING (
    CASE WHEN is_official
      THEN private.is_platform_admin()
      ELSE owner_id = auth.uid()
    END
  );

-- 7. Restrict matches manual override to platform admins only
DROP POLICY IF EXISTS "matches admin manual override" ON public.matches;
CREATE POLICY "matches platform admin manual override" ON public.matches
  FOR UPDATE TO authenticated
  USING (private.is_platform_admin())
  WITH CHECK (private.is_platform_admin() AND manual_override = true);

-- 8. Seed: make me a platform admin and create one official tournament per active competition
INSERT INTO public.platform_admins (user_id)
VALUES ('ca488990-6ba6-4bd6-a9e4-7591581d9332')
ON CONFLICT DO NOTHING;

DO $$
DECLARE
  c RECORD;
  v_code text;
BEGIN
  FOR c IN
    SELECT id, name, season FROM public.competitions WHERE is_active = true
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
      'Torneio oficial Predz da ' || c.name || ' ' || c.season || '. Aberto a todos.',
      v_code,
      'ca488990-6ba6-4bd6-a9e4-7591581d9332',
      c.id,
      true,
      true,
      '#22C55E'
    );
  END LOOP;
END $$;
