-- Expert library visibility:
-- Admins can see all experts. Other users can only see experts that are
-- already connected to projects they are assigned to.

CREATE OR REPLACE FUNCTION public.can_access_expert(_expert_id uuid)
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
      OR (
        e.email IS NOT NULL
        AND public.extract_email_from_text(wgm.contact) = lower(e.email)
      )
    JOIN public.work_groups wg ON wg.id = wgm.group_id
    WHERE e.id = _expert_id
      AND wgm.member_role = 'expert'
      AND public.can_access_project(wg.project_id)
  )
  OR EXISTS (
    SELECT 1
    FROM public.experts e
    JOIN public.project_members pm
      ON pm.user_id = e.user_id
    WHERE e.id = _expert_id
      AND public.can_access_project(pm.project_id)
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
