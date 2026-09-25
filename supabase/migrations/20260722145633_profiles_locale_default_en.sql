-- Default profile language: English (browser/local preference still wins on client)
ALTER TABLE public.profiles
  ALTER COLUMN locale SET DEFAULT 'en';
