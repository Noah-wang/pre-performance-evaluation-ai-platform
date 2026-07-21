-- Persist meeting voice recordings so switching away from the page does not
-- lose generated audio files.

CREATE TABLE IF NOT EXISTS public.meeting_recordings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL REFERENCES public.meeting_minutes(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  file_path text NOT NULL,
  file_name text,
  mime_type text NOT NULL DEFAULT 'audio/webm',
  speaker text NOT NULL DEFAULT '发言人',
  duration_sec numeric,
  transcript text,
  transcript_status text NOT NULL DEFAULT 'ready',
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.meeting_recordings ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_meeting_recordings_meeting ON public.meeting_recordings(meeting_id);
CREATE INDEX IF NOT EXISTS idx_meeting_recordings_project ON public.meeting_recordings(project_id);

DROP TRIGGER IF EXISTS trg_meeting_recordings_updated ON public.meeting_recordings;
CREATE TRIGGER trg_meeting_recordings_updated
  BEFORE UPDATE ON public.meeting_recordings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP POLICY IF EXISTS "meeting_recordings scoped select" ON public.meeting_recordings;
CREATE POLICY "meeting_recordings scoped select"
  ON public.meeting_recordings FOR SELECT TO authenticated
  USING (public.can_access_project(project_id));

DROP POLICY IF EXISTS "meeting_recordings insert" ON public.meeting_recordings;
CREATE POLICY "meeting_recordings insert"
  ON public.meeting_recordings FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = created_by
    AND public.can_access_project(project_id)
    AND EXISTS (
      SELECT 1 FROM public.meeting_minutes mm
      WHERE mm.id = meeting_recordings.meeting_id
        AND mm.project_id = meeting_recordings.project_id
    )
  );

DROP POLICY IF EXISTS "meeting_recordings update" ON public.meeting_recordings;
CREATE POLICY "meeting_recordings update"
  ON public.meeting_recordings FOR UPDATE TO authenticated
  USING (
    auth.uid() = created_by
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
  )
  WITH CHECK (
    auth.uid() = created_by
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
  );

DROP POLICY IF EXISTS "meeting_recordings delete" ON public.meeting_recordings;
CREATE POLICY "meeting_recordings delete"
  ON public.meeting_recordings FOR DELETE TO authenticated
  USING (
    auth.uid() = created_by
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
  );

INSERT INTO storage.buckets (id, name, public)
VALUES ('meeting-audios', 'meeting-audios', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "meeting-audios auth read" ON storage.objects;
CREATE POLICY "meeting-audios auth read"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'meeting-audios');

DROP POLICY IF EXISTS "meeting-audios owner insert" ON storage.objects;
CREATE POLICY "meeting-audios owner insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'meeting-audios'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "meeting-audios owner update" ON storage.objects;
CREATE POLICY "meeting-audios owner update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'meeting-audios'
    AND (
      auth.uid()::text = (storage.foldername(name))[1]
      OR public.has_role(auth.uid(), 'admin'::public.app_role)
    )
  );

DROP POLICY IF EXISTS "meeting-audios owner delete" ON storage.objects;
CREATE POLICY "meeting-audios owner delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'meeting-audios'
    AND (
      auth.uid()::text = (storage.foldername(name))[1]
      OR public.has_role(auth.uid(), 'admin'::public.app_role)
    )
  );
