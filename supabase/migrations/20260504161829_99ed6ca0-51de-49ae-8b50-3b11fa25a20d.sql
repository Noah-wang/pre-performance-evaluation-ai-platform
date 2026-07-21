
-- 1. 评估包（财政一包业务）
CREATE TABLE public.evaluation_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT,
  name TEXT NOT NULL,
  fiscal_year INTEGER NOT NULL DEFAULT EXTRACT(year FROM now())::int,
  fiscal_dept TEXT,        -- 财政支出科室
  agent_org TEXT,          -- 中介机构
  manager TEXT,            -- 财政专管员
  notes TEXT,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.evaluation_packages ENABLE ROW LEVEL SECURITY;
CREATE POLICY ep_select ON public.evaluation_packages FOR SELECT TO authenticated USING (true);
CREATE POLICY ep_insert ON public.evaluation_packages FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY ep_update ON public.evaluation_packages FOR UPDATE TO authenticated USING (auth.uid() = created_by OR has_role(auth.uid(),'admin'));
CREATE POLICY ep_delete ON public.evaluation_packages FOR DELETE TO authenticated USING (auth.uid() = created_by OR has_role(auth.uid(),'admin'));
CREATE TRIGGER ep_updated_at BEFORE UPDATE ON public.evaluation_packages FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. 项目表扩展字段
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS package_id UUID,
  ADD COLUMN IF NOT EXISTS budget_unit TEXT,        -- 预算单位（与 unit 区分；unit 仍为申请单位）
  ADD COLUMN IF NOT EXISTS expense_dept TEXT,       -- 支出科室
  ADD COLUMN IF NOT EXISTS manager TEXT,            -- 专管员
  ADD COLUMN IF NOT EXISTS list_attribute TEXT,     -- 项目清单属性：政府购买服务/重点建设/公共服务
  ADD COLUMN IF NOT EXISTS project_attribute TEXT,  -- 项目属性：新增项目/延续项目
  ADD COLUMN IF NOT EXISTS agent_org TEXT;          -- 中介机构

CREATE INDEX IF NOT EXISTS idx_projects_package ON public.projects(package_id);

-- 3. 专家打分（在线打分）
CREATE TABLE public.expert_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  indicator_id UUID NOT NULL,        -- 关联 evaluation_indicators
  expert_id UUID,                    -- 关联 experts（可空，支持自由填名）
  expert_name TEXT NOT NULL,
  expert_type TEXT,                  -- business/management/finance
  score NUMERIC NOT NULL DEFAULT 0,
  max_score NUMERIC NOT NULL DEFAULT 0,
  deduct_reason TEXT,
  scored_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, indicator_id, expert_name)
);
ALTER TABLE public.expert_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY es_select ON public.expert_scores FOR SELECT TO authenticated USING (true);
CREATE POLICY es_insert ON public.expert_scores FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY es_update ON public.expert_scores FOR UPDATE TO authenticated USING (auth.uid() = created_by OR has_role(auth.uid(),'admin'));
CREATE POLICY es_delete ON public.expert_scores FOR DELETE TO authenticated USING (auth.uid() = created_by OR has_role(auth.uid(),'admin'));
CREATE INDEX idx_expert_scores_project ON public.expert_scores(project_id);

-- 4. 专家打分表上传
CREATE TABLE public.expert_score_sheets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  expert_name TEXT NOT NULL,
  expert_type TEXT,
  file_path TEXT NOT NULL,
  file_name TEXT,
  parsed_status TEXT NOT NULL DEFAULT 'pending', -- pending/parsing/parsed/failed
  parsed_payload JSONB,
  total_score NUMERIC,
  notes TEXT,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.expert_score_sheets ENABLE ROW LEVEL SECURITY;
CREATE POLICY ess_select ON public.expert_score_sheets FOR SELECT TO authenticated USING (true);
CREATE POLICY ess_insert ON public.expert_score_sheets FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY ess_update ON public.expert_score_sheets FOR UPDATE TO authenticated USING (auth.uid() = created_by OR has_role(auth.uid(),'admin'));
CREATE POLICY ess_delete ON public.expert_score_sheets FOR DELETE TO authenticated USING (auth.uid() = created_by OR has_role(auth.uid(),'admin'));
CREATE TRIGGER ess_updated_at BEFORE UPDATE ON public.expert_score_sheets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5. 创建专家打分表的存储桶
INSERT INTO storage.buckets (id, name, public)
VALUES ('expert-sheets', 'expert-sheets', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "expert sheets owner select"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'expert-sheets' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "expert sheets owner insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'expert-sheets' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "expert sheets owner delete"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'expert-sheets' AND auth.uid()::text = (storage.foldername(name))[1]);
