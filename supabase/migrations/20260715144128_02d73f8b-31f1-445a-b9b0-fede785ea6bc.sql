
REVOKE ALL ON FUNCTION public.enforce_prizes_private_only() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.clear_prizes_on_public() FROM PUBLIC, anon, authenticated;
