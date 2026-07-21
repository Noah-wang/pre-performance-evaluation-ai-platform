
-- ========== 资料收集 ==========
CREATE TABLE public.materials (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  category TEXT NOT NULL DEFAULT '其他',
  name TEXT NOT NULL,
  required BOOLEAN NOT NULL DEFAULT true,
  status TEXT NOT NULL DEFAULT 'missing', -- missing | received | approved | rejected
  file_path TEXT,
  file_name TEXT,
  review_note TEXT,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.materials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "materials select" ON public.materials FOR SELECT TO authenticated USING (true);
CREATE POLICY "materials insert" ON public.materials FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY "materials update" ON public.materials FOR UPDATE TO authenticated USING ((auth.uid() = created_by) OR has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "materials delete" ON public.materials FOR DELETE TO authenticated USING ((auth.uid() = created_by) OR has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER materials_updated_at BEFORE UPDATE ON public.materials
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ========== 现场调研 ==========
CREATE TABLE public.field_records (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  location TEXT NOT NULL,
  research_date DATE NOT NULL DEFAULT CURRENT_DATE,
  participants TEXT,
  findings TEXT,
  conclusion TEXT,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.field_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fr select" ON public.field_records FOR SELECT TO authenticated USING (true);
CREATE POLICY "fr insert" ON public.field_records FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY "fr update" ON public.field_records FOR UPDATE TO authenticated USING ((auth.uid() = created_by) OR has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "fr delete" ON public.field_records FOR DELETE TO authenticated USING ((auth.uid() = created_by) OR has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER field_records_updated_at BEFORE UPDATE ON public.field_records
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.field_photos (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  record_id UUID NOT NULL REFERENCES public.field_records(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  caption TEXT,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.field_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fp select" ON public.field_photos FOR SELECT TO authenticated USING (true);
CREATE POLICY "fp insert" ON public.field_photos FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY "fp delete" ON public.field_photos FOR DELETE TO authenticated USING ((auth.uid() = created_by) OR has_role(auth.uid(), 'admin'::app_role));

CREATE TABLE public.field_signatures (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  record_id UUID NOT NULL REFERENCES public.field_records(id) ON DELETE CASCADE,
  expert_name TEXT NOT NULL,
  signature_data TEXT NOT NULL, -- base64 PNG dataURL
  signed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL
);

ALTER TABLE public.field_signatures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fs select" ON public.field_signatures FOR SELECT TO authenticated USING (true);
CREATE POLICY "fs insert" ON public.field_signatures FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY "fs delete" ON public.field_signatures FOR DELETE TO authenticated USING ((auth.uid() = created_by) OR has_role(auth.uid(), 'admin'::app_role));

-- ========== 会议纪要 ==========
CREATE TABLE public.meeting_minutes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  meeting_date DATE NOT NULL DEFAULT CURRENT_DATE,
  content TEXT NOT NULL,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.meeting_minutes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mm select" ON public.meeting_minutes FOR SELECT TO authenticated USING (true);
CREATE POLICY "mm insert" ON public.meeting_minutes FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY "mm update" ON public.meeting_minutes FOR UPDATE TO authenticated USING ((auth.uid() = created_by) OR has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "mm delete" ON public.meeting_minutes FOR DELETE TO authenticated USING ((auth.uid() = created_by) OR has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER meeting_minutes_updated_at BEFORE UPDATE ON public.meeting_minutes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.meeting_analyses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  minute_id UUID NOT NULL REFERENCES public.meeting_minutes(id) ON DELETE CASCADE,
  opinions JSONB NOT NULL DEFAULT '{}'::jsonb, -- {business:[...],management:[...],finance:[...]}
  summary TEXT,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.meeting_analyses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ma select" ON public.meeting_analyses FOR SELECT TO authenticated USING (true);
CREATE POLICY "ma insert" ON public.meeting_analyses FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY "ma delete" ON public.meeting_analyses FOR DELETE TO authenticated USING ((auth.uid() = created_by) OR has_role(auth.uid(), 'admin'::app_role));

-- ========== Storage Buckets ==========
INSERT INTO storage.buckets (id, name, public) VALUES ('project-materials', 'project-materials', false)
  ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('field-photos', 'field-photos', true)
  ON CONFLICT (id) DO NOTHING;

-- project-materials policies (private)
CREATE POLICY "pm own select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'project-materials' AND (auth.uid()::text = (storage.foldername(name))[1] OR has_role(auth.uid(), 'admin'::app_role)));
CREATE POLICY "pm own insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'project-materials' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "pm own delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'project-materials' AND (auth.uid()::text = (storage.foldername(name))[1] OR has_role(auth.uid(), 'admin'::app_role)));

-- field-photos policies (public read, auth write)
CREATE POLICY "fph public select" ON storage.objects FOR SELECT
  USING (bucket_id = 'field-photos');
CREATE POLICY "fph auth insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'field-photos' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "fph own delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'field-photos' AND (auth.uid()::text = (storage.foldername(name))[1] OR has_role(auth.uid(), 'admin'::app_role)));
