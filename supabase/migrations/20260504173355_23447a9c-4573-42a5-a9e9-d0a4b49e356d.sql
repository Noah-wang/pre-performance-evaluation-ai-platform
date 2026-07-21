
ALTER TABLE public.experts ADD COLUMN IF NOT EXISTS avoid_units text;

CREATE OR REPLACE FUNCTION public.get_expert_participation(_expert_name text)
RETURNS TABLE(
  project_id uuid,
  project_name text,
  project_unit text,
  scored_count bigint,
  avg_score numeric,
  last_scored_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.name,
    p.unit,
    COUNT(es.id)::bigint,
    ROUND(AVG(es.score)::numeric, 2),
    MAX(es.scored_at)
  FROM public.expert_scores es
  JOIN public.projects p ON p.id = es.project_id
  WHERE es.expert_name = _expert_name
  GROUP BY p.id, p.name, p.unit
  ORDER BY MAX(es.scored_at) DESC;
$$;
