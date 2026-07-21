-- 1. reports 表新增 AI 整改建议字段
ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS ai_rectification jsonb DEFAULT NULL;

-- 2. 项目归档表
CREATE TABLE IF NOT EXISTS public.archived_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  report_id uuid,
  project_snapshot jsonb NOT NULL,
  conclusion text,
  archive_note text,
  archived_by uuid NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_archived_projects_project ON public.archived_projects(project_id);
CREATE INDEX IF NOT EXISTS idx_archived_projects_archived_at ON public.archived_projects(archived_at DESC);

ALTER TABLE public.archived_projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ap select" ON public.archived_projects
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "ap insert" ON public.archived_projects
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = archived_by);

CREATE POLICY "ap delete" ON public.archived_projects
  FOR DELETE TO authenticated
  USING ((auth.uid() = archived_by) OR has_role(auth.uid(), 'admin'::app_role));