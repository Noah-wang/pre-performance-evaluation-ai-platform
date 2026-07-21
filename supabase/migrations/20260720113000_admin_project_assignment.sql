-- Project visibility is now assigned centrally by admins.
-- Admins can see every project. Group members and experts can only see
-- projects listed in project_members for their user_id.

ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "project_members scoped select" ON public.project_members;
CREATE POLICY "project_members scoped select"
  ON public.project_members FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR user_id = auth.uid()
  );

DROP POLICY IF EXISTS "project_members admin insert" ON public.project_members;
CREATE POLICY "project_members admin insert"
  ON public.project_members FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "project_members admin update" ON public.project_members;
CREATE POLICY "project_members admin update"
  ON public.project_members FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "project_members admin delete" ON public.project_members;
CREATE POLICY "project_members admin delete"
  ON public.project_members FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE OR REPLACE FUNCTION public.can_access_project(_project_id uuid)
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
    FROM public.project_members pm
    WHERE pm.project_id = _project_id
      AND pm.user_id = v_uid
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.visible_project_ids()
RETURNS TABLE(project_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id
  FROM public.projects p
  WHERE public.can_access_project(p.id);
$$;

GRANT EXECUTE ON FUNCTION public.can_access_project(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.visible_project_ids() TO authenticated;

-- Retire the previous link-based invitation flow. Project membership should
-- only be assigned from the admin permission page.
UPDATE public.project_invites
SET revoked_at = coalesce(revoked_at, now())
WHERE accepted_at IS NULL;

DROP POLICY IF EXISTS "project_invites scoped insert" ON public.project_invites;
DROP POLICY IF EXISTS "project_invites creator update" ON public.project_invites;
DROP POLICY IF EXISTS "project_invites creator delete" ON public.project_invites;

CREATE OR REPLACE FUNCTION public.accept_project_invite(_token text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object('ok', false, 'error', 'invite_flow_disabled');
$$;

GRANT EXECUTE ON FUNCTION public.accept_project_invite(text) TO authenticated;
