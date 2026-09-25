
-- Helper: is the current user admin of any tournament using this competition
CREATE OR REPLACE FUNCTION private.is_tournament_admin_for_competition(_competition_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tournaments t
    JOIN public.tournament_members m ON m.tournament_id = t.id
    WHERE t.competition_id = _competition_id
      AND m.user_id = auth.uid()
      AND m.role IN ('owner','admin')
  );
$$;

-- Allow tournament admins to correct match results manually.
-- Requires the row to carry manual_override = true after the update.
DROP POLICY IF EXISTS "matches admin manual override" ON public.matches;
CREATE POLICY "matches admin manual override"
ON public.matches
FOR UPDATE
TO authenticated
USING (private.is_tournament_admin_for_competition(competition_id))
WITH CHECK (
  private.is_tournament_admin_for_competition(competition_id)
  AND manual_override = true
);
