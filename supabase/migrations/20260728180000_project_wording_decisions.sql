-- 口径确认属于项目级决定：同一个项目反复生成报告时不应重复选择，
-- 换个人、换台设备打开也要看到同样的口径。
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS wording_decisions jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.projects.wording_decisions IS
  '人工确认的口径：键为核验问题的 code，值为选定的表述。';
