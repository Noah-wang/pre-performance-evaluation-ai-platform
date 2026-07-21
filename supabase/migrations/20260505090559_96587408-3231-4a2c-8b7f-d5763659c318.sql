
CREATE TABLE public.rectification_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  report_id uuid,
  category text NOT NULL DEFAULT '通用',
  title text NOT NULL,
  detail text,
  priority text NOT NULL DEFAULT 'medium',
  responsible text,
  status text NOT NULL DEFAULT 'todo',
  due_date date,
  completed_at timestamptz,
  source text NOT NULL DEFAULT 'manual',
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.rectification_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rt select" ON public.rectification_tasks FOR SELECT TO authenticated USING (true);
CREATE POLICY "rt insert" ON public.rectification_tasks FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY "rt update" ON public.rectification_tasks FOR UPDATE TO authenticated USING ((auth.uid() = created_by) OR has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "rt delete" ON public.rectification_tasks FOR DELETE TO authenticated USING ((auth.uid() = created_by) OR has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_rectification_tasks_updated_at
BEFORE UPDATE ON public.rectification_tasks
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_rt_project ON public.rectification_tasks(project_id);
CREATE INDEX idx_rt_status ON public.rectification_tasks(status);
