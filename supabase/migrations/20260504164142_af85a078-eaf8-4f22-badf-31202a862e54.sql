
-- 资料↔指标 多对多关联表（保留 materials.indicator_id 作为主关联用于既有 UI 兼容）
CREATE TABLE IF NOT EXISTS public.material_indicators (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  material_id uuid NOT NULL REFERENCES public.materials(id) ON DELETE CASCADE,
  indicator_id uuid NOT NULL REFERENCES public.evaluation_indicators(id) ON DELETE CASCADE,
  relevance smallint NOT NULL DEFAULT 3,  -- 1~5 关联强度（AI/人工标定）
  source text NOT NULL DEFAULT 'manual',  -- manual | ai
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(material_id, indicator_id)
);
CREATE INDEX IF NOT EXISTS idx_mi_material ON public.material_indicators(material_id);
CREATE INDEX IF NOT EXISTS idx_mi_indicator ON public.material_indicators(indicator_id);

ALTER TABLE public.material_indicators ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mi select" ON public.material_indicators FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.materials m
      WHERE m.id = material_indicators.material_id
        AND (m.created_by = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))
    )
  );
CREATE POLICY "mi insert" ON public.material_indicators FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = created_by AND
    EXISTS (SELECT 1 FROM public.materials m WHERE m.id = material_id AND m.created_by = auth.uid())
  );
CREATE POLICY "mi delete" ON public.material_indicators FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.materials m
      WHERE m.id = material_indicators.material_id
        AND (m.created_by = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))
    )
  );

-- 历史数据回填：把 materials.indicator_id 写入关联表
INSERT INTO public.material_indicators (material_id, indicator_id, relevance, source, created_by)
SELECT id, indicator_id, 3, 'manual', created_by
FROM public.materials
WHERE indicator_id IS NOT NULL
ON CONFLICT DO NOTHING;
