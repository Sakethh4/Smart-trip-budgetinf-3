-- Remove older duplicate trigger names and keep the current canonical triggers
DROP TRIGGER IF EXISTS trg_groups_unique_code ON public.groups;
DROP TRIGGER IF EXISTS trg_groups_add_creator ON public.groups;
DROP TRIGGER IF EXISTS trg_groups_touch ON public.groups;

-- Make sure the canonical triggers exist exactly once
DROP TRIGGER IF EXISTS trg_ensure_unique_join_code ON public.groups;
CREATE TRIGGER trg_ensure_unique_join_code
BEFORE INSERT OR UPDATE OF join_code ON public.groups
FOR EACH ROW
EXECUTE FUNCTION public.ensure_unique_join_code();

DROP TRIGGER IF EXISTS trg_add_creator_as_member ON public.groups;
CREATE TRIGGER trg_add_creator_as_member
AFTER INSERT ON public.groups
FOR EACH ROW
EXECUTE FUNCTION public.add_creator_as_member();

DROP TRIGGER IF EXISTS trg_groups_touch_updated_at ON public.groups;
CREATE TRIGGER trg_groups_touch_updated_at
BEFORE UPDATE ON public.groups
FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();

NOTIFY pgrst, 'reload schema';