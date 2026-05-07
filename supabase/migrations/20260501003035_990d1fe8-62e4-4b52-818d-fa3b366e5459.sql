-- RLS helper should be used by policies, not called directly from the app API
REVOKE ALL ON FUNCTION public.is_group_member(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_group_member(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.is_group_member(uuid, uuid) FROM authenticated;

NOTIFY pgrst, 'reload schema';