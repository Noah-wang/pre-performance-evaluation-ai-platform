-- 异步解析：Edge Function 只提交任务并记录 job_id，耗时的 OCR 由常驻的
-- 解析服务在后台完成，用户上传后无需等待。
ALTER TABLE public.knowledge_files
  ADD COLUMN IF NOT EXISTS parse_job_id text,
  ADD COLUMN IF NOT EXISTS parse_started_at timestamptz;

COMMENT ON COLUMN public.knowledge_files.parse_job_id IS
  '解析服务中的后台任务 ID；为 NULL 表示没有进行中的解析。';
