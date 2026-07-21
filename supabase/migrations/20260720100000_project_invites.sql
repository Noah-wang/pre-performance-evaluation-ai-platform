-- Project invite links.
-- A project invite lets a user register/login and then explicitly join one
-- project. This becomes the strongest signal for project visibility.

CREATE TABLE IF NOT EXISTS public.project_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'group_member'
    CHECK (role IN ('group_member', 'expert')),
  source text NOT NULL DEFAULT 'invite',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_project_members_project ON public.project_members(project_id);
CREATE INDEX IF NOT EXISTS idx_project_members_user ON public.project_members(user_id);

ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "project_members scoped select" ON public.project_members;
CREATE POLICY "project_members scoped select"
  ON public.project_members FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR user_id = auth.uid()
    OR public.can_access_project(project_id)
  );

DROP POLICY IF EXISTS "project_members admin insert" ON public.project_members;
CREATE POLICY "project_members admin insert"
  ON public.project_members FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR (public.has_role(auth.uid(), 'group_member'::public.app_role) AND public.can_access_project(project_id))
  );

DROP POLICY IF EXISTS "project_members admin delete" ON public.project_members;
CREATE POLICY "project_members admin delete"
  ON public.project_members FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR created_by = auth.uid()
  );

CREATE TABLE IF NOT EXISTS public.project_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  group_id uuid REFERENCES public.work_groups(id) ON DELETE SET NULL,
  email text,
  role text NOT NULL DEFAULT 'group_member'
    CHECK (role IN ('group_member', 'expert')),
  expires_at timestamptz,
  accepted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_invites_token ON public.project_invites(token);
CREATE INDEX IF NOT EXISTS idx_project_invites_project ON public.project_invites(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_invites_created_by ON public.project_invites(created_by);

ALTER TABLE public.project_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "project_invites creator select" ON public.project_invites;
CREATE POLICY "project_invites creator select"
  ON public.project_invites FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR created_by = auth.uid()
    OR accepted_by = auth.uid()
  );

DROP POLICY IF EXISTS "project_invites scoped insert" ON public.project_invites;
CREATE POLICY "project_invites scoped insert"
  ON public.project_invites FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = created_by
    AND (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR (public.has_role(auth.uid(), 'group_member'::public.app_role) AND public.can_access_project(project_id))
    )
  );

DROP POLICY IF EXISTS "project_invites creator update" ON public.project_invites;
CREATE POLICY "project_invites creator update"
  ON public.project_invites FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR created_by = auth.uid()
    OR accepted_by = auth.uid()
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR created_by = auth.uid()
    OR accepted_by = auth.uid()
  );

DROP POLICY IF EXISTS "project_invites creator delete" ON public.project_invites;
CREATE POLICY "project_invites creator delete"
  ON public.project_invites FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR created_by = auth.uid()
  );

CREATE OR REPLACE FUNCTION public.can_access_project(_project_id uuid)
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
    FROM public.projects p
    WHERE p.id = _project_id
      AND p.created_by = v_uid
  )
  OR EXISTS (
    SELECT 1
    FROM public.project_members pm
    WHERE pm.project_id = _project_id
      AND pm.user_id = v_uid
  )
  OR EXISTS (
    SELECT 1
    FROM public.work_groups wg
    WHERE wg.project_id = _project_id
      AND (
        wg.created_by = v_uid
        OR public.can_access_work_group(wg.id)
      )
  )
  OR EXISTS (
    SELECT 1
    FROM public.expert_scores es
    LEFT JOIN public.experts e
      ON e.id = es.expert_id
      OR lower(e.name) = lower(es.expert_name)
    WHERE es.project_id = _project_id
      AND (
        es.created_by = v_uid
        OR e.user_id = v_uid
        OR (v_email <> '' AND lower(coalesce(e.email, '')) = v_email)
      )
  )
  OR EXISTS (
    SELECT 1
    FROM public.expert_score_sheets ess
    LEFT JOIN public.experts e ON lower(e.name) = lower(ess.expert_name)
    WHERE ess.project_id = _project_id
      AND (
        ess.created_by = v_uid
        OR e.user_id = v_uid
        OR (v_email <> '' AND lower(coalesce(e.email, '')) = v_email)
      )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_project_invite(_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text := public.current_user_email();
  v_invite public.project_invites%rowtype;
  v_project record;
  v_profile record;
  v_member_name text;
  v_member_role text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT * INTO v_invite
  FROM public.project_invites
  WHERE token = _token
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF v_invite.revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'revoked');
  END IF;

  IF v_invite.expires_at IS NOT NULL AND v_invite.expires_at < now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'expired');
  END IF;

  IF v_invite.accepted_by IS NOT NULL AND v_invite.accepted_by <> v_uid THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_accepted');
  END IF;

  IF nullif(trim(coalesce(v_invite.email, '')), '') IS NOT NULL
    AND lower(v_invite.email) <> v_email THEN
    RETURN jsonb_build_object('ok', false, 'error', 'email_mismatch', 'expected_email', lower(v_invite.email));
  END IF;

  SELECT id, name, unit INTO v_project
  FROM public.projects
  WHERE id = v_invite.project_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'project_not_found');
  END IF;

  INSERT INTO public.project_members(project_id, user_id, role, source, created_by)
  VALUES (v_invite.project_id, v_uid, v_invite.role, 'invite', v_invite.created_by)
  ON CONFLICT (project_id, user_id)
  DO UPDATE SET role = EXCLUDED.role;

  IF v_invite.group_id IS NOT NULL THEN
    SELECT display_name, organization INTO v_profile
    FROM public.profiles
    WHERE user_id = v_uid;

    v_member_name := coalesce(nullif(trim(v_profile.display_name), ''), split_part(v_email, '@', 1), '受邀成员');
    v_member_role := CASE WHEN v_invite.role = 'expert' THEN 'expert' ELSE 'member' END;

    IF NOT EXISTS (
      SELECT 1 FROM public.work_group_members
      WHERE group_id = v_invite.group_id
        AND user_id = v_uid
    ) THEN
      INSERT INTO public.work_group_members(
        group_id, user_id, member_name, member_role, organization, contact, created_by
      )
      VALUES (
        v_invite.group_id,
        v_uid,
        v_member_name,
        v_member_role,
        nullif(trim(coalesce(v_profile.organization, '')), ''),
        v_email,
        v_invite.created_by
      );
    END IF;
  END IF;

  UPDATE public.project_invites
  SET accepted_by = v_uid,
      accepted_at = coalesce(accepted_at, now())
  WHERE id = v_invite.id;

  RETURN jsonb_build_object(
    'ok', true,
    'project_id', v_project.id,
    'project_name', v_project.name,
    'project_unit', v_project.unit,
    'role', v_invite.role
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_project_invite(text) TO authenticated;
