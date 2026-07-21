-- Keyword branch for hybrid RAG retrieval.
-- It complements pgvector search with deterministic matches in title/file/category/content.

CREATE OR REPLACE FUNCTION public.keyword_knowledge_chunks(
  query_terms text[],
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
  keyword_score double precision
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH terms AS (
    SELECT DISTINCT lower(trim(term)) AS term
    FROM unnest(query_terms) AS term
    WHERE length(trim(term)) >= 2
    LIMIT 24
  ),
  scored AS (
    SELECT
      c.id AS chunk_id,
      f.id AS file_id,
      f.project_id,
      f.title,
      f.file_name,
      COALESCE(f.category, '通用资料') AS category,
      c.chunk_index,
      c.content,
      SUM(
        CASE WHEN lower(c.content) LIKE '%' || t.term || '%' THEN 3 ELSE 0 END
        + CASE WHEN lower(COALESCE(f.title, '') || ' ' || COALESCE(f.file_name, '')) LIKE '%' || t.term || '%' THEN 2 ELSE 0 END
        + CASE WHEN lower(COALESCE(f.category, '')) LIKE '%' || t.term || '%' THEN 1 ELSE 0 END
      )::double precision AS keyword_score
    FROM public.knowledge_chunks c
    JOIN public.knowledge_files f ON f.id = c.file_id
    JOIN terms t ON true
    WHERE f.status = 'indexed'
      AND (match_project_id IS NULL OR f.project_id IS NULL OR f.project_id = match_project_id)
    GROUP BY c.id, f.id, f.project_id, f.title, f.file_name, f.category, c.chunk_index, c.content
  )
  SELECT *
  FROM scored
  WHERE keyword_score > 0
  ORDER BY keyword_score DESC, chunk_index ASC
  LIMIT LEAST(GREATEST(match_count, 1), 30);
$$;

GRANT EXECUTE ON FUNCTION public.keyword_knowledge_chunks(text[], integer, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.keyword_knowledge_chunks(text[], integer, uuid) TO service_role;
