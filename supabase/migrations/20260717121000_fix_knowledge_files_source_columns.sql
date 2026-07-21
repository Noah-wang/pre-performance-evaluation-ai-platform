-- Compatibility fix for environments where knowledge_files was created before
-- project-material indexing fields existed.

ALTER TABLE public.knowledge_files
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'knowledge_upload',
  ADD COLUMN IF NOT EXISTS source_id uuid,
  ADD COLUMN IF NOT EXISTS source_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS text_hash text,
  ADD COLUMN IF NOT EXISTS indexed_at timestamptz;

UPDATE public.knowledge_files
SET source_type = COALESCE(NULLIF(source_type, ''), 'knowledge_upload')
WHERE source_type IS NULL OR source_type = '';

DROP INDEX IF EXISTS public.knowledge_files_source_unique_idx;
CREATE UNIQUE INDEX IF NOT EXISTS knowledge_files_source_unique_idx
  ON public.knowledge_files(source_type, source_id);

CREATE INDEX IF NOT EXISTS knowledge_files_project_status_idx
  ON public.knowledge_files(project_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS knowledge_files_indexed_project_idx
  ON public.knowledge_files(project_id, indexed_at DESC)
  WHERE status = 'indexed';

NOTIFY pgrst, 'reload schema';
