-- Knowledge base / RAG foundation.
-- Stores uploaded files, extracted chunks, and lightweight vector embeddings.

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.knowledge_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  title text NOT NULL,
  file_name text NOT NULL,
  file_path text NOT NULL,
  file_type text,
  category text DEFAULT '通用资料',
  tags text[] DEFAULT '{}',
  summary text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'indexing', 'indexed', 'error')),
  chunk_count integer NOT NULL DEFAULT 0,
  error_message text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.knowledge_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id uuid NOT NULL REFERENCES public.knowledge_files(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  chunk_index integer NOT NULL,
  content text NOT NULL,
  token_count integer NOT NULL DEFAULT 0,
  embedding vector(384) NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS knowledge_files_project_idx
  ON public.knowledge_files(project_id);

CREATE INDEX IF NOT EXISTS knowledge_files_status_idx
  ON public.knowledge_files(status);

CREATE INDEX IF NOT EXISTS knowledge_chunks_file_idx
  ON public.knowledge_chunks(file_id);

CREATE INDEX IF NOT EXISTS knowledge_chunks_project_idx
  ON public.knowledge_chunks(project_id);

CREATE INDEX IF NOT EXISTS knowledge_chunks_embedding_idx
  ON public.knowledge_chunks
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 50);

ALTER TABLE public.knowledge_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_chunks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "knowledge files select" ON public.knowledge_files;
CREATE POLICY "knowledge files select"
ON public.knowledge_files
FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "knowledge files insert" ON public.knowledge_files;
CREATE POLICY "knowledge files insert"
ON public.knowledge_files
FOR INSERT TO authenticated
WITH CHECK (created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "knowledge files update" ON public.knowledge_files;
CREATE POLICY "knowledge files update"
ON public.knowledge_files
FOR UPDATE TO authenticated
USING (created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "knowledge files delete" ON public.knowledge_files;
CREATE POLICY "knowledge files delete"
ON public.knowledge_files
FOR DELETE TO authenticated
USING (created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "knowledge chunks select" ON public.knowledge_chunks;
CREATE POLICY "knowledge chunks select"
ON public.knowledge_chunks
FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "knowledge chunks service write" ON public.knowledge_chunks;
CREATE POLICY "knowledge chunks service write"
ON public.knowledge_chunks
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

INSERT INTO storage.buckets (id, name, public)
VALUES ('knowledge-files', 'knowledge-files', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "knowledge storage read" ON storage.objects;
CREATE POLICY "knowledge storage read"
ON storage.objects
FOR SELECT TO authenticated
USING (bucket_id = 'knowledge-files');

DROP POLICY IF EXISTS "knowledge storage insert" ON storage.objects;
CREATE POLICY "knowledge storage insert"
ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'knowledge-files'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

DROP POLICY IF EXISTS "knowledge storage delete" ON storage.objects;
CREATE POLICY "knowledge storage delete"
ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'knowledge-files'
  AND (
    auth.uid()::text = (storage.foldername(name))[1]
    OR public.has_role(auth.uid(), 'admin'::app_role)
  )
);

CREATE OR REPLACE FUNCTION public.match_knowledge_chunks(
  query_embedding vector(384),
  match_count integer DEFAULT 8,
  match_project_id uuid DEFAULT NULL
)
RETURNS TABLE (
  chunk_id uuid,
  file_id uuid,
  project_id uuid,
  title text,
  file_name text,
  category text,
  chunk_index integer,
  content text,
  similarity double precision
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id AS chunk_id,
    f.id AS file_id,
    f.project_id,
    f.title,
    f.file_name,
    COALESCE(f.category, '通用资料') AS category,
    c.chunk_index,
    c.content,
    1 - (c.embedding <=> query_embedding) AS similarity
  FROM public.knowledge_chunks c
  JOIN public.knowledge_files f ON f.id = c.file_id
  WHERE f.status = 'indexed'
    AND (match_project_id IS NULL OR f.project_id IS NULL OR f.project_id = match_project_id)
  ORDER BY c.embedding <=> query_embedding
  LIMIT LEAST(GREATEST(match_count, 1), 20);
$$;

GRANT EXECUTE ON FUNCTION public.match_knowledge_chunks(vector, integer, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.match_knowledge_chunks(vector, integer, uuid) TO service_role;
