-- Trigger-only helper should not be callable directly from the app API
REVOKE ALL ON FUNCTION public.add_creator_as_member() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.add_creator_as_member() FROM anon;
REVOKE ALL ON FUNCTION public.add_creator_as_member() FROM authenticated;

NOTIFY pgrst, 'reload schema';