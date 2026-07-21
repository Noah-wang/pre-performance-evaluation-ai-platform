CREATE TABLE public.doc_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key text NOT NULL UNIQUE,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'general',
  content text NOT NULL DEFAULT '',
  variables text,
  enabled boolean NOT NULL DEFAULT true,
  notes text,
  updated_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_doc_templates_category ON public.doc_templates(category);

ALTER TABLE public.doc_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "doc_templates read all" ON public.doc_templates
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "doc_templates write admin" ON public.doc_templates
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_doc_templates_updated_at
  BEFORE UPDATE ON public.doc_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER audit_doc_templates
  AFTER INSERT OR UPDATE OR DELETE ON public.doc_templates
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

-- Seed common templates
INSERT INTO public.doc_templates (template_key, name, category, content, variables, notes) VALUES
('report.header', '评估报告抬头', 'report', '{{project_name}} 事前绩效评估报告', '{{project_name}}', '导出 Word 报告页眉/标题区使用'),
('report.intro', '评估报告引言段', 'report', '受{{unit}}委托，本评估组依据财政绩效评估相关规范，对"{{project_name}}"项目进行事前绩效评估。本报告基于资料审查、现场调研与专家评议形成。', '{{unit}} {{project_name}}', '生成评估报告时的固定引言'),
('report.footer', '评估报告落款', 'report', '评估机构（盖章）：________________   日期：{{date}}', '{{date}}', NULL),
('opinion.title', '专家意见书标题', 'expert', '{{project_name}} 专家评议意见书', '{{project_name}}', NULL),
('opinion.footer', '专家意见书落款', 'expert', '专家签名：____________   日期：{{date}}', '{{date}}', NULL),
('notice.title', '专家任命书标题', 'expert', '关于聘请{{expert_name}}担任评估专家的通知', '{{expert_name}}', NULL),
('watermark.text', '水印文字模板', 'security', '{{user_email}} · {{date}} · 内部使用', '{{user_email}} {{date}}', '导出文档与页面水印共用'),
('plan.title', '工作方案标题', 'plan', '{{project_name}} 评估工作方案', '{{project_name}}', NULL);
