
-- Attach the join code uniqueness trigger
CREATE TRIGGER trg_ensure_unique_join_code
BEFORE INSERT ON public.groups
FOR EACH ROW
EXECUTE FUNCTION public.ensure_unique_join_code();

-- Attach the creator-as-member trigger
CREATE TRIGGER trg_add_creator_as_member
AFTER INSERT ON public.groups
FOR EACH ROW
EXECUTE FUNCTION public.add_creator_as_member();
