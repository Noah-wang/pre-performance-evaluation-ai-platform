
DROP FUNCTION IF EXISTS public.get_experts_public();

CREATE OR REPLACE FUNCTION public.get_experts_public()
RETURNS TABLE(
  id uuid, name text, expert_type text, organization text, title text,
  specialty text, available boolean, avoid_units text, created_at timestamptz
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, name, expert_type, organization, title, specialty, available, avoid_units, created_at
  FROM public.experts
  ORDER BY created_at DESC;
$$;
