-- Add trip-specific fields to the groups table
ALTER TABLE public.groups
  ADD COLUMN IF NOT EXISTS start_date DATE,
  ADD COLUMN IF NOT EXISTS end_date DATE,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'planning'
    CHECK (status IN ('planning', 'active', 'completed')),
  ADD COLUMN IF NOT EXISTS cover_emoji TEXT NOT NULL DEFAULT '✈️';

-- Index for filtering trips by status
CREATE INDEX IF NOT EXISTS idx_groups_status ON public.groups (status);

-- Index for date-range queries
CREATE INDEX IF NOT EXISTS idx_groups_dates ON public.groups (start_date, end_date);

NOTIFY pgrst, 'reload schema';
