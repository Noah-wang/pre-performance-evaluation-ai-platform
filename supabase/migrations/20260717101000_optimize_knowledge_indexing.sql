-- Make RAG indexing incremental and project-material aware.

ALTER TABLE public.knowledge_files
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'knowledge_upload',
  ADD COLUMN IF NOT EXISTS source_id uuid,
  ADD COLUMN IF NOT EXISTS source_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS text_hash text,
  ADD COLUMN IF NOT EXISTS indexed_at timestamptz;

DROP INDEX IF EXISTS public.knowledge_files_source_unique_idx;
CREATE UNIQUE INDEX IF NOT EXISTS knowledge_files_source_unique_idx
  ON public.knowledge_files(source_type, source_id);

CREATE INDEX IF NOT EXISTS knowledge_files_project_status_idx
  ON public.knowledge_files(project_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS knowledge_chunks_project_file_idx
  ON public.knowledge_chunks(project_id, file_id, chunk_index);

CREATE INDEX IF NOT EXISTS knowledge_files_indexed_project_idx
  ON public.knowledge_files(project_id, indexed_at DESC)
  WHERE status = 'indexed';

DROP POLICY IF EXISTS "knowledge files material owner update" ON public.knowledge_files;
CREATE POLICY "knowledge files material owner update"
ON public.knowledge_files
FOR UPDATE TO authenticated
USING (
  source_type = 'material'
  AND EXISTS (
    SELECT 1 FROM public.materials m
    WHERE m.id = source_id
      AND (m.created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role))
  )
)
WITH CHECK (
  source_type = 'material'
  AND EXISTS (
    SELECT 1 FROM public.materials m
    WHERE m.id = source_id
      AND (m.created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role))
  )
);

DROP POLICY IF EXISTS "knowledge files material owner delete" ON public.knowledge_files;
CREATE POLICY "knowledge files material owner delete"
ON public.knowledge_files
FOR DELETE TO authenticated
USING (
  source_type = 'material'
  AND EXISTS (
    SELECT 1 FROM public.materials m
    WHERE m.id = source_id
      AND (m.created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role))
  )
);
