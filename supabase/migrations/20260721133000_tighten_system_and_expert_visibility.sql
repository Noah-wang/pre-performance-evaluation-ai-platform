-- Tighten visibility for indicator systems and expert library.
-- Admins see all. Regular users only see their own indicator systems and
-- experts that are related to projects assigned to them.

CREATE OR REPLACE FUNCTION public.can_access_evaluation_system(_system_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN false;
  END IF;

  IF public.has_role(v_uid, 'admin'::public.app_role) THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.evaluation_systems es
    WHERE es.id = _system_id
      AND es.created_by = v_uid
  )
  OR EXISTS (
    SELECT 1
    FROM public.projects p
    WHERE p.evaluation_system_id = _system_id
      AND public.can_access_project(p.id)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.can_access_evaluation_system(uuid) TO authenticated;

DROP POLICY IF EXISTS "es select" ON public.evaluation_systems;
DROP POLICY IF EXISTS "evaluation_systems scoped select" ON public.evaluation_systems;
CREATE POLICY "evaluation_systems scoped select"
  ON public.evaluation_systems FOR SELECT TO authenticated
  USING (public.can_access_evaluation_system(id));

DROP POLICY IF EXISTS "ei select" ON public.evaluation_indicators;
DROP POLICY IF EXISTS "evaluation_indicators scoped select" ON public.evaluation_indicators;
CREATE POLICY "evaluation_indicators scoped select"
  ON public.evaluation_indicators FOR SELECT TO authenticated
  USING (public.can_access_evaluation_system(system_id));

CREATE OR REPLACE FUNCTION public.can_access_expert(_expert_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text := public.current_user_email();
BEGIN
  IF v_uid IS NULL THEN
    RETURN false;
  END IF;

  IF public.has_role(v_uid, 'admin'::public.app_role) THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.experts e
    WHERE e.id = _expert_id
      AND (
        e.user_id = v_uid
        OR e.created_by = v_uid
        OR (v_email <> '' AND lower(coalesce(e.email, '')) = v_email)
      )
  )
  OR EXISTS (
    SELECT 1
    FROM public.experts e
    JOIN public.expert_scores es
      ON es.expert_id = e.id
      OR lower(es.expert_name) = lower(e.name)
    WHERE e.id = _expert_id
      AND public.can_access_project(es.project_id)
  )
  OR EXISTS (
    SELECT 1
    FROM public.experts e
    JOIN public.expert_score_sheets ess
      ON lower(ess.expert_name) = lower(e.name)
    WHERE e.id = _expert_id
      AND public.can_access_project(ess.project_id)
  )
  OR EXISTS (
    SELECT 1
    FROM public.experts e
    JOIN public.work_group_members wgm
      ON lower(wgm.member_name) = lower(e.name)
      OR (e.email IS NOT NULL AND public.extract_email_from_text(wgm.contact) = lower(e.email))
    JOIN public.work_groups wg ON wg.id = wgm.group_id
    WHERE e.id = _expert_id
      AND wgm.member_role = 'expert'
      AND public.can_access_project(wg.project_id)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.can_access_expert(uuid) TO authenticated;

DROP POLICY IF EXISTS "Experts viewable by authenticated" ON public.experts;
DROP POLICY IF EXISTS "Experts owner or admin full select" ON public.experts;
DROP POLICY IF EXISTS "Experts public fields viewable" ON public.experts;
DROP POLICY IF EXISTS "experts scoped select" ON public.experts;
CREATE POLICY "experts scoped select"
  ON public.experts FOR SELECT TO authenticated
  USING (public.can_access_expert(id));

DROP FUNCTION IF EXISTS public.get_experts_public();
CREATE OR REPLACE FUNCTION public.get_experts_public()
RETURNS TABLE(
  id uuid, name text, expert_type text, organization text, title text,
  specialty text, available boolean, avoid_units text, created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, name, expert_type, organization, title, specialty, available, avoid_units, created_at
  FROM public.experts e
  WHERE public.can_access_expert(e.id)
  ORDER BY created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_experts_public() TO authenticated;

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
    AND public.can_access_project(p.id)
  GROUP BY p.id, p.name, p.unit
  ORDER BY MAX(es.scored_at) DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_expert_participation(text) TO authenticated;
