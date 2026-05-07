-- enums
CREATE TYPE public.split_type AS ENUM ('equal_all','equal_selected','custom');

-- groups (trips)
CREATE TABLE public.groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  total_budget NUMERIC(14,2) NOT NULL DEFAULT 0,
  alert_threshold_pct INTEGER NOT NULL DEFAULT 80,
  destination TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- members
CREATE TABLE public.group_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  display_name TEXT NOT NULL,
  email TEXT,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (group_id, user_id),
  UNIQUE (group_id, display_name)
);

-- expenses
CREATE TABLE public.expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  payer_member_id UUID NOT NULL REFERENCES public.group_members(id) ON DELETE CASCADE,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  category TEXT NOT NULL DEFAULT 'other',
  description TEXT,
  expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
  split_type public.split_type NOT NULL DEFAULT 'equal_all',
  is_auto BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.expense_splits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id UUID NOT NULL REFERENCES public.expenses(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES public.group_members(id) ON DELETE CASCADE,
  amount NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  UNIQUE (expense_id, member_id)
);

-- recurring expenses
CREATE TABLE public.recurring_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  payer_member_id UUID NOT NULL REFERENCES public.group_members(id) ON DELETE CASCADE,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  category TEXT NOT NULL DEFAULT 'other',
  description TEXT,
  frequency TEXT NOT NULL CHECK (frequency IN ('daily','weekly','monthly')),
  next_run_date DATE NOT NULL DEFAULT CURRENT_DATE,
  end_date DATE,
  active BOOLEAN NOT NULL DEFAULT true,
  split_type public.split_type NOT NULL DEFAULT 'equal_all',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- settlements
CREATE TABLE public.settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  from_member_id UUID NOT NULL REFERENCES public.group_members(id) ON DELETE CASCADE,
  to_member_id UUID NOT NULL REFERENCES public.group_members(id) ON DELETE CASCADE,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  note TEXT,
  settled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
);

-- alerts log (so we don't spam)
CREATE TABLE public.budget_alerts_sent (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  threshold_pct INTEGER NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (group_id, threshold_pct)
);

-- helper function (SECURITY DEFINER to avoid RLS recursion)
CREATE OR REPLACE FUNCTION public.is_group_member(_group_id UUID, _user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.group_members
    WHERE group_id = _group_id AND user_id = _user_id
  );
$$;

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_groups_touch BEFORE UPDATE ON public.groups
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Auto-add creator as member
CREATE OR REPLACE FUNCTION public.add_creator_as_member()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uname TEXT;
  uemail TEXT;
BEGIN
  SELECT COALESCE(raw_user_meta_data->>'display_name', email), email
    INTO uname, uemail
  FROM auth.users WHERE id = NEW.created_by;
  INSERT INTO public.group_members (group_id, user_id, display_name, email)
  VALUES (NEW.id, NEW.created_by, COALESCE(uname,'Me'), uemail)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_groups_add_creator AFTER INSERT ON public.groups
FOR EACH ROW EXECUTE FUNCTION public.add_creator_as_member();

-- Enable RLS
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_splits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recurring_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_alerts_sent ENABLE ROW LEVEL SECURITY;

-- groups policies
CREATE POLICY "members can view groups" ON public.groups
FOR SELECT TO authenticated
USING (public.is_group_member(id, auth.uid()) OR created_by = auth.uid());

CREATE POLICY "users can create groups" ON public.groups
FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());

CREATE POLICY "creator can update group" ON public.groups
FOR UPDATE TO authenticated USING (created_by = auth.uid());

CREATE POLICY "creator can delete group" ON public.groups
FOR DELETE TO authenticated USING (created_by = auth.uid());

-- group_members
CREATE POLICY "members can view members" ON public.group_members
FOR SELECT TO authenticated
USING (public.is_group_member(group_id, auth.uid()));

CREATE POLICY "members can add members" ON public.group_members
FOR INSERT TO authenticated
WITH CHECK (
  public.is_group_member(group_id, auth.uid())
  OR EXISTS (SELECT 1 FROM public.groups g WHERE g.id = group_id AND g.created_by = auth.uid())
);

CREATE POLICY "members can remove members" ON public.group_members
FOR DELETE TO authenticated
USING (public.is_group_member(group_id, auth.uid()));

-- expenses
CREATE POLICY "members can view expenses" ON public.expenses
FOR SELECT TO authenticated USING (public.is_group_member(group_id, auth.uid()));

CREATE POLICY "members can add expenses" ON public.expenses
FOR INSERT TO authenticated
WITH CHECK (public.is_group_member(group_id, auth.uid()) AND created_by = auth.uid());

CREATE POLICY "creator can update own expenses" ON public.expenses
FOR UPDATE TO authenticated USING (created_by = auth.uid());

CREATE POLICY "creator can delete own expenses" ON public.expenses
FOR DELETE TO authenticated USING (created_by = auth.uid());

-- expense_splits
CREATE POLICY "members can view splits" ON public.expense_splits
FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.expenses e WHERE e.id = expense_id AND public.is_group_member(e.group_id, auth.uid())));

CREATE POLICY "members can add splits" ON public.expense_splits
FOR INSERT TO authenticated
WITH CHECK (EXISTS (SELECT 1 FROM public.expenses e WHERE e.id = expense_id AND public.is_group_member(e.group_id, auth.uid())));

CREATE POLICY "members can delete splits" ON public.expense_splits
FOR DELETE TO authenticated
USING (EXISTS (SELECT 1 FROM public.expenses e WHERE e.id = expense_id AND public.is_group_member(e.group_id, auth.uid())));

-- recurring
CREATE POLICY "members view recurring" ON public.recurring_expenses
FOR SELECT TO authenticated USING (public.is_group_member(group_id, auth.uid()));
CREATE POLICY "members add recurring" ON public.recurring_expenses
FOR INSERT TO authenticated WITH CHECK (public.is_group_member(group_id, auth.uid()) AND created_by = auth.uid());
CREATE POLICY "creator update recurring" ON public.recurring_expenses
FOR UPDATE TO authenticated USING (created_by = auth.uid());
CREATE POLICY "creator delete recurring" ON public.recurring_expenses
FOR DELETE TO authenticated USING (created_by = auth.uid());

-- settlements
CREATE POLICY "members view settlements" ON public.settlements
FOR SELECT TO authenticated USING (public.is_group_member(group_id, auth.uid()));
CREATE POLICY "members add settlements" ON public.settlements
FOR INSERT TO authenticated WITH CHECK (public.is_group_member(group_id, auth.uid()) AND created_by = auth.uid());
CREATE POLICY "creator delete settlements" ON public.settlements
FOR DELETE TO authenticated USING (created_by = auth.uid());

-- alerts
CREATE POLICY "members view alerts" ON public.budget_alerts_sent
FOR SELECT TO authenticated USING (public.is_group_member(group_id, auth.uid()));

-- indexes
CREATE INDEX idx_members_group ON public.group_members(group_id);
CREATE INDEX idx_members_user ON public.group_members(user_id);
CREATE INDEX idx_expenses_group ON public.expenses(group_id);
CREATE INDEX idx_splits_expense ON public.expense_splits(expense_id);
CREATE INDEX idx_recurring_active ON public.recurring_expenses(active, next_run_date);