-- Ensure join codes are generated and unique when trips are created
CREATE OR REPLACE FUNCTION public.generate_join_code()
RETURNS text
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result text := '';
  i int;
BEGIN
  FOR i IN 1..6 LOOP
    result := result || substr(chars, 1 + floor(random() * length(chars))::int, 1);
  END LOOP;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_unique_join_code()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.join_code IS NULL OR btrim(NEW.join_code) = '' THEN
    NEW.join_code := public.generate_join_code();
  END IF;

  NEW.join_code := upper(NEW.join_code);

  WHILE EXISTS (
    SELECT 1
    FROM public.groups
    WHERE join_code = NEW.join_code
      AND id IS DISTINCT FROM NEW.id
  ) LOOP
    NEW.join_code := public.generate_join_code();
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.add_creator_as_member()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  uname text;
  uemail text;
BEGIN
  SELECT COALESCE(raw_user_meta_data->>'display_name', email), email
    INTO uname, uemail
  FROM auth.users
  WHERE id = NEW.created_by;

  INSERT INTO public.group_members (group_id, user_id, display_name, email)
  VALUES (NEW.id, NEW.created_by, COALESCE(uname, 'Me'), uemail)
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Add constraints/indexes required by the trigger and code lookup
CREATE UNIQUE INDEX IF NOT EXISTS groups_join_code_unique_idx
ON public.groups (join_code);

CREATE UNIQUE INDEX IF NOT EXISTS group_members_group_user_unique_idx
ON public.group_members (group_id, user_id)
WHERE user_id IS NOT NULL;

-- Recreate triggers idempotently
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

-- Ask PostgREST to reload schema cache after structural changes
NOTIFY pgrst, 'reload schema';