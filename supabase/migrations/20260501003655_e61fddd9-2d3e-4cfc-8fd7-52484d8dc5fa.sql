-- The app's trip RLS policies need authenticated users to be able to execute this helper.
-- It is still safe because the function only returns true/false membership and is required by policies.
GRANT EXECUTE ON FUNCTION public.is_group_member(uuid, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.is_group_member(uuid, uuid) FROM anon;

NOTIFY pgrst, 'reload schema';