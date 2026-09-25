-- Applied remotely as drop_duplicate_predictions_match_index.
-- Kept for version alignment with supabase_migrations.
-- (Idempotent: only drops if a legacy duplicate name still exists.)
DROP INDEX IF EXISTS public.predictions_match_id_idx;
DROP INDEX IF EXISTS public.idx_predictions_match_id;
