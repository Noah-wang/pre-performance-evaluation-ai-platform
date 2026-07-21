CREATE TABLE public.meeting_files (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  minute_id UUID NOT NULL REFERENCES public.meeting_minutes(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  file_kind TEXT NOT NULL DEFAULT 'meeting_material',
  expert_name TEXT,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  notes TEXT,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_meeting_files_minute ON public.meeting_files(minute_id);
CREATE INDEX idx_meeting_files_project ON public.meeting_files(project_id);

ALTER TABLE public.meeting_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mf select" ON public.meeting_files FOR SELECT TO authenticated USING (true);
CREATE POLICY "mf insert" ON public.meeting_files FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY "mf delete" ON public.meeting_files FOR DELETE TO authenticated
  USING ((auth.uid() = created_by) OR has_role(auth.uid(), 'admin'::app_role));
