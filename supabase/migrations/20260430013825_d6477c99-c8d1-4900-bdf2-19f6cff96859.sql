-- Random 6-char code generator (uppercase letters + digits, no ambiguous chars)
CREATE OR REPLACE FUNCTION public.generate_join_code()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result TEXT := '';
  i INT;
BEGIN
  FOR i IN 1..6 LOOP
    result := result || substr(chars, 1 + floor(random() * length(chars))::int, 1);
  END LOOP;
  RETURN result;
END;
$$;

ALTER TABLE public.groups
  ADD COLUMN IF NOT EXISTS join_code TEXT UNIQUE;

-- Backfill existing rows
DO $$
DECLARE r RECORD; new_code TEXT;
BEGIN
  FOR r IN SELECT id FROM public.groups WHERE join_code IS NULL LOOP
    LOOP
      new_code := public.generate_join_code();
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.groups WHERE join_code = new_code);
    END LOOP;
    UPDATE public.groups SET join_code = new_code WHERE id = r.id;
  END LOOP;
END $$;

ALTER TABLE public.groups ALTER COLUMN join_code SET NOT NULL;
ALTER TABLE public.groups ALTER COLUMN join_code SET DEFAULT public.generate_join_code();

-- Trigger to ensure unique code on insert if collision
CREATE OR REPLACE FUNCTION public.ensure_unique_join_code()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  WHILE EXISTS (SELECT 1 FROM public.groups WHERE join_code = NEW.join_code AND id <> NEW.id) LOOP
    NEW.join_code := public.generate_join_code();
  END LOOP;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_groups_unique_code ON public.groups;
CREATE TRIGGER trg_groups_unique_code BEFORE INSERT ON public.groups
FOR EACH ROW EXECUTE FUNCTION public.ensure_unique_join_code();

REVOKE EXECUTE ON FUNCTION public.generate_join_code() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ensure_unique_join_code() FROM PUBLIC, anon, authenticated;

-- Secure RPC: lets a signed-in user join a group by code
CREATE OR REPLACE FUNCTION public.join_group_by_code(_code TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  g_id UUID;
  uname TEXT;
  uemail TEXT;
  uid UUID := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT id INTO g_id FROM public.groups WHERE upper(join_code) = upper(_code) LIMIT 1;
  IF g_id IS NULL THEN
    RAISE EXCEPTION 'Invalid code';
  END IF;

  IF EXISTS (SELECT 1 FROM public.group_members WHERE group_id = g_id AND user_id = uid) THEN
    RETURN g_id;
  END IF;

  SELECT COALESCE(raw_user_meta_data->>'display_name', email), email
    INTO uname, uemail
  FROM auth.users WHERE id = uid;

  -- Resolve display name collision within the group
  IF EXISTS (SELECT 1 FROM public.group_members WHERE group_id = g_id AND display_name = COALESCE(uname,'Member')) THEN
    uname := COALESCE(uname,'Member') || ' ' || substr(uid::text, 1, 4);
  END IF;

  INSERT INTO public.group_members (group_id, user_id, display_name, email)
  VALUES (g_id, uid, COALESCE(uname,'Member'), uemail);

  RETURN g_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.join_group_by_code(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_group_by_code(TEXT) TO authenticated;