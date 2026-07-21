-- ============= Step 1: field_audios 录音表 + storage bucket =============
CREATE TABLE public.field_audios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id uuid NOT NULL REFERENCES public.field_records(id) ON DELETE CASCADE,
  file_path text NOT NULL,
  duration_sec numeric,
  transcript text,
  transcript_status text NOT NULL DEFAULT 'pending', -- pending | transcribing | done | failed
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.field_audios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fa select" ON public.field_audios FOR SELECT TO authenticated USING (true);
CREATE POLICY "fa insert" ON public.field_audios FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY "fa update" ON public.field_audios FOR UPDATE TO authenticated
  USING ((auth.uid() = created_by) OR has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "fa delete" ON public.field_audios FOR DELETE TO authenticated
  USING ((auth.uid() = created_by) OR has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER trg_field_audios_updated
  BEFORE UPDATE ON public.field_audios
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_field_audios_record ON public.field_audios(record_id);

-- storage bucket
INSERT INTO storage.buckets (id, name, public) VALUES ('field-audios', 'field-audios', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "field-audios owner read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'field-audios' AND (auth.uid()::text = (storage.foldername(name))[1] OR has_role(auth.uid(), 'admin'::app_role)));
CREATE POLICY "field-audios owner insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'field-audios' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "field-audios owner update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'field-audios' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "field-audios owner delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'field-audios' AND auth.uid()::text = (storage.foldername(name))[1]);

-- ============= Step 2: 评估指标体系库 =============
CREATE TABLE public.evaluation_systems (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category text,                      -- 行业大类：基础设施/民生/信息化…
  description text,
  is_template boolean NOT NULL DEFAULT false,  -- 系统模板 vs 用户自建
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.evaluation_indicators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  system_id uuid NOT NULL REFERENCES public.evaluation_systems(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES public.evaluation_indicators(id) ON DELETE CASCADE,
  level integer NOT NULL DEFAULT 1,    -- 1=一级 2=二级 3=三级
  code text,                            -- 1.1.2 等编号
  name text NOT NULL,
  weight numeric DEFAULT 0,             -- 权重分
  scoring_method text,                  -- 评分方法说明
  required_materials text,              -- 关联资料（建议清单逗号分隔）
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.evaluation_systems ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evaluation_indicators ENABLE ROW LEVEL SECURITY;

CREATE POLICY "es select" ON public.evaluation_systems FOR SELECT TO authenticated USING (true);
CREATE POLICY "es insert" ON public.evaluation_systems FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY "es update" ON public.evaluation_systems FOR UPDATE TO authenticated
  USING ((auth.uid() = created_by) OR has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "es delete" ON public.evaluation_systems FOR DELETE TO authenticated
  USING ((auth.uid() = created_by) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "ei select" ON public.evaluation_indicators FOR SELECT TO authenticated USING (true);
CREATE POLICY "ei insert" ON public.evaluation_indicators FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY "ei update" ON public.evaluation_indicators FOR UPDATE TO authenticated
  USING ((auth.uid() = created_by) OR has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "ei delete" ON public.evaluation_indicators FOR DELETE TO authenticated
  USING ((auth.uid() = created_by) OR has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER trg_eval_systems_updated BEFORE UPDATE ON public.evaluation_systems
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_eval_indicators_system ON public.evaluation_indicators(system_id);
CREATE INDEX idx_eval_indicators_parent ON public.evaluation_indicators(parent_id);

-- 给 materials 表加可选关联指标
ALTER TABLE public.materials ADD COLUMN IF NOT EXISTS indicator_id uuid REFERENCES public.evaluation_indicators(id) ON DELETE SET NULL;

-- 给 projects 表加 评估体系/工作组关联（用于自动生成方案）+ 自定义字段 + 收费计算
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS evaluation_system_id uuid REFERENCES public.evaluation_systems(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS fee_calculation jsonb NOT NULL DEFAULT '{}'::jsonb;

-- ============= Step 3: 评估方案表 =============
CREATE TABLE public.evaluation_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  group_id uuid REFERENCES public.work_groups(id) ON DELETE SET NULL,
  title text NOT NULL,
  content text NOT NULL,           -- AI 生成的方案 markdown
  ai_model text,
  status text NOT NULL DEFAULT 'draft', -- draft | confirmed
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.evaluation_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ep select" ON public.evaluation_plans FOR SELECT TO authenticated USING (true);
CREATE POLICY "ep insert" ON public.evaluation_plans FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY "ep update" ON public.evaluation_plans FOR UPDATE TO authenticated
  USING ((auth.uid() = created_by) OR has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "ep delete" ON public.evaluation_plans FOR DELETE TO authenticated
  USING ((auth.uid() = created_by) OR has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER trg_eval_plans_updated BEFORE UPDATE ON public.evaluation_plans
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_eval_plans_project ON public.evaluation_plans(project_id);
