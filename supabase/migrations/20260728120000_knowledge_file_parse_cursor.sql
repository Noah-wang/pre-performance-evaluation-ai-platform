-- 长文档（几十页的扫描件）单次解析必然超过 Edge Function 的 5 分钟上限。
-- 记录解析游标后，一次调用只推进若干页，剩余部分由后续调用接着做，
-- 中途失败也不会丢掉已完成的页。
ALTER TABLE public.knowledge_files
  ADD COLUMN IF NOT EXISTS parse_cursor integer,
  ADD COLUMN IF NOT EXISTS parse_total_pages integer;

COMMENT ON COLUMN public.knowledge_files.parse_cursor IS
  '下一次解析应从第几页开始（0 基）；为 NULL 表示已解析完成。';
COMMENT ON COLUMN public.knowledge_files.parse_total_pages IS
  '文档总页数，用于展示解析进度。';
