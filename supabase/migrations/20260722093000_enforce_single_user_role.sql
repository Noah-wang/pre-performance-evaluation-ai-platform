-- Keep exactly one system role per account.
-- If historical data contains multiple roles, keep the highest privilege:
-- admin > group_member > expert.
WITH ranked_roles AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY user_id
      ORDER BY
        CASE role
          WHEN 'admin'::public.app_role THEN 1
          WHEN 'group_member'::public.app_role THEN 2
          WHEN 'expert'::public.app_role THEN 3
          ELSE 99
        END,
        created_at ASC,
        id ASC
    ) AS role_rank
  FROM public.user_roles
)
DELETE FROM public.user_roles ur
USING ranked_roles rr
WHERE ur.id = rr.id
  AND rr.role_rank > 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_roles_one_role_per_user'
      AND conrelid = 'public.user_roles'::regclass
  ) THEN
    ALTER TABLE public.user_roles
      ADD CONSTRAINT user_roles_one_role_per_user UNIQUE (user_id);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.set_user_role(target_user_id UUID, target_role public.app_role)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only administrators can change user roles';
  END IF;

  IF target_user_id = auth.uid() AND target_role <> 'admin'::public.app_role THEN
    RAISE EXCEPTION 'Cannot remove administrator role from the current account';
  END IF;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (target_user_id, target_role)
  ON CONFLICT (user_id) DO UPDATE
    SET role = EXCLUDED.role;
END;
$$;

REVOKE ALL ON FUNCTION public.set_user_role(UUID, public.app_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_user_role(UUID, public.app_role) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_user_profile(
  target_user_id UUID,
  target_display_name TEXT,
  target_organization TEXT,
  target_phone TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only administrators can change user profiles';
  END IF;

  UPDATE public.profiles
  SET
    display_name = NULLIF(trim(coalesce(target_display_name, '')), ''),
    organization = NULLIF(trim(coalesce(target_organization, '')), ''),
    phone = NULLIF(trim(coalesce(target_phone, '')), '')
  WHERE user_id = target_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_user_profile(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_user_profile(UUID, TEXT, TEXT, TEXT) TO authenticated;

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
    FROM public.projects p
    WHERE p.id = _project_id
      AND p.created_by = v_uid
  )
  OR EXISTS (
    SELECT 1
    FROM public.project_members pm
    WHERE pm.project_id = _project_id
      AND pm.user_id = v_uid
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.can_access_project(uuid) TO authenticated;
