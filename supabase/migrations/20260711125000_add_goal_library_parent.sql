ALTER TABLE public.goal_library
  ADD COLUMN IF NOT EXISTS parent_goal_id uuid REFERENCES public.goal_library(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_goal_library_parent_goal_id
  ON public.goal_library(parent_goal_id);
