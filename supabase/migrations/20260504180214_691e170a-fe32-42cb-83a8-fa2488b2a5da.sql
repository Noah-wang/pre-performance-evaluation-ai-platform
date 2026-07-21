CREATE TABLE public.goal_library (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text,
  level integer NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 3),
  code text,
  name text NOT NULL,
  weight numeric DEFAULT 0,
  scoring_method text,
  required_materials text,
  notes text,
  source_system_id uuid REFERENCES public.evaluation_systems(id) ON DELETE SET NULL,
  source_indicator_id uuid REFERENCES public.evaluation_indicators(id) ON DELETE SET NULL,
  usage_count integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_goal_library_category ON public.goal_library(category);
CREATE INDEX idx_goal_library_level ON public.goal_library(level);
CREATE INDEX idx_goal_library_name_lower ON public.goal_library(lower(name));

ALTER TABLE public.goal_library ENABLE ROW LEVEL SECURITY;

CREATE POLICY "goal_library read all" ON public.goal_library
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "goal_library insert" ON public.goal_library
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);

CREATE POLICY "goal_library update own or admin" ON public.goal_library
  FOR UPDATE TO authenticated USING (
    auth.uid() = created_by OR public.has_role(auth.uid(), 'admin'::app_role)
  );

CREATE POLICY "goal_library delete own or admin" ON public.goal_library
  FOR DELETE TO authenticated USING (
    auth.uid() = created_by OR public.has_role(auth.uid(), 'admin'::app_role)
  );

CREATE TRIGGER update_goal_library_updated_at
  BEFORE UPDATE ON public.goal_library
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER audit_goal_library
  AFTER INSERT OR UPDATE OR DELETE ON public.goal_library
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();
