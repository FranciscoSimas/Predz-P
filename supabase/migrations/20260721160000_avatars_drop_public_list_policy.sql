-- Fix advisor: public buckets + broad SELECT allow listing all objects.
-- Public URL access does not need that policy; upsert still needs own SELECT.

DROP POLICY IF EXISTS "Avatar images are publicly accessible" ON storage.objects;

DROP POLICY IF EXISTS "Users can select own avatar" ON storage.objects;
CREATE POLICY "Users can select own avatar"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
