-- Project visibility scope.
-- Admins can see everything. Group members and experts can only see projects
-- they created or participate in through work groups / expert assignments.

ALTER TABLE public.work_group_members
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.experts
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_wgm_user_id ON public.work_group_members(user_id);
CREATE INDEX IF NOT EXISTS idx_experts_user_id ON public.experts(user_id);
CREATE INDEX IF NOT EXISTS idx_experts_email_lower ON public.experts(lower(email));

CREATE OR REPLACE FUNCTION public.extract_email_from_text(_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(substring(coalesce(_value, '') FROM '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'));
$$;

CREATE OR REPLACE FUNCTION public.resolve_user_id_by_email(_email text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT u.id
  FROM auth.users u
  WHERE lower(u.email) = lower(nullif(trim(coalesce(_email, '')), ''))
  ORDER BY u.created_at DESC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.link_work_group_member_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_email text;
BEGIN
  IF NEW.user_id IS NULL THEN
    v_email := public.extract_email_from_text(NEW.contact);
    IF v_email IS NOT NULL THEN
      NEW.user_id := public.resolve_user_id_by_email(v_email);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.link_expert_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NEW.user_id IS NULL AND NEW.email IS NOT NULL THEN
    NEW.user_id := public.resolve_user_id_by_email(NEW.email);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS link_work_group_member_user ON public.work_group_members;
CREATE TRIGGER link_work_group_member_user
  BEFORE INSERT OR UPDATE OF contact, user_id
  ON public.work_group_members
  FOR EACH ROW EXECUTE FUNCTION public.link_work_group_member_user();

DROP TRIGGER IF EXISTS link_expert_user ON public.experts;
CREATE TRIGGER link_expert_user
  BEFORE INSERT OR UPDATE OF email, user_id
  ON public.experts
  FOR EACH ROW EXECUTE FUNCTION public.link_expert_user();

UPDATE public.work_group_members
SET user_id = public.resolve_user_id_by_email(public.extract_email_from_text(contact))
WHERE user_id IS NULL
  AND public.extract_email_from_text(contact) IS NOT NULL;

UPDATE public.experts
SET user_id = public.resolve_user_id_by_email(email)
WHERE user_id IS NULL
  AND nullif(trim(coalesce(email, '')), '') IS NOT NULL;

CREATE OR REPLACE FUNCTION public.current_user_email()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

CREATE OR REPLACE FUNCTION public.can_access_work_group(_group_id uuid)
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
    FROM public.work_groups wg
    WHERE wg.id = _group_id
      AND wg.created_by = v_uid
  )
  OR EXISTS (
    SELECT 1
    FROM public.work_group_members wgm
    WHERE wgm.group_id = _group_id
      AND (
        wgm.user_id = v_uid
        OR wgm.created_by = v_uid
        OR (v_email <> '' AND public.extract_email_from_text(wgm.contact) = v_email)
        OR (v_email <> '' AND lower(coalesce(wgm.contact, '')) LIKE '%' || v_email || '%')
      )
  );
END;
$$;

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
GRANT EXECUTE ON FUNCTION public.can_access_work_group(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.visible_project_ids() TO authenticated;

-- Projects
DROP POLICY IF EXISTS "Projects viewable by authenticated" ON public.projects;
DROP POLICY IF EXISTS "Projects scoped select" ON public.projects;
CREATE POLICY "Projects scoped select"
  ON public.projects FOR SELECT TO authenticated
  USING (public.can_access_project(id));

DROP POLICY IF EXISTS "Projects maintainable by members" ON public.projects;
DROP POLICY IF EXISTS "Projects scoped update" ON public.projects;
CREATE POLICY "Projects scoped update"
  ON public.projects FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR (public.has_role(auth.uid(), 'group_member'::public.app_role) AND public.can_access_project(id))
    OR auth.uid() = created_by
  );

DROP POLICY IF EXISTS "Projects deletable by members" ON public.projects;
DROP POLICY IF EXISTS "Projects scoped delete" ON public.projects;
CREATE POLICY "Projects scoped delete"
  ON public.projects FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR auth.uid() = created_by
  );

-- Packages are visible when at least one project inside the package is visible.
DROP POLICY IF EXISTS ep_select ON public.evaluation_packages;
DROP POLICY IF EXISTS "evaluation_packages scoped select" ON public.evaluation_packages;
CREATE POLICY "evaluation_packages scoped select"
  ON public.evaluation_packages FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR auth.uid() = created_by
    OR EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.package_id = evaluation_packages.id
        AND public.can_access_project(p.id)
    )
  );

-- Work groups and related rows
DROP POLICY IF EXISTS "wg select" ON public.work_groups;
DROP POLICY IF EXISTS "wg scoped select" ON public.work_groups;
CREATE POLICY "wg scoped select"
  ON public.work_groups FOR SELECT TO authenticated
  USING (public.can_access_project(project_id));

DROP POLICY IF EXISTS "wg update" ON public.work_groups;
DROP POLICY IF EXISTS "wg scoped update" ON public.work_groups;
CREATE POLICY "wg scoped update"
  ON public.work_groups FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR (public.has_role(auth.uid(), 'group_member'::public.app_role) AND public.can_access_project(project_id))
    OR auth.uid() = created_by
  );

DROP POLICY IF EXISTS "wg delete" ON public.work_groups;
DROP POLICY IF EXISTS "wg scoped delete" ON public.work_groups;
CREATE POLICY "wg scoped delete"
  ON public.work_groups FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role) OR auth.uid() = created_by);

DROP POLICY IF EXISTS "wgm select" ON public.work_group_members;
DROP POLICY IF EXISTS "wgm scoped select" ON public.work_group_members;
CREATE POLICY "wgm scoped select"
  ON public.work_group_members FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.work_groups wg
      WHERE wg.id = work_group_members.group_id
        AND public.can_access_project(wg.project_id)
    )
  );

DROP POLICY IF EXISTS "wgm update" ON public.work_group_members;
DROP POLICY IF EXISTS "wgm scoped update" ON public.work_group_members;
CREATE POLICY "wgm scoped update"
  ON public.work_group_members FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.work_groups wg
      WHERE wg.id = work_group_members.group_id
        AND (
          public.has_role(auth.uid(), 'admin'::public.app_role)
          OR (public.has_role(auth.uid(), 'group_member'::public.app_role) AND public.can_access_project(wg.project_id))
          OR auth.uid() = work_group_members.created_by
        )
    )
  );

DROP POLICY IF EXISTS "wgm delete" ON public.work_group_members;
DROP POLICY IF EXISTS "wgm scoped delete" ON public.work_group_members;
CREATE POLICY "wgm scoped delete"
  ON public.work_group_members FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR auth.uid() = created_by
  );

DROP POLICY IF EXISTS "wt select" ON public.work_tasks;
DROP POLICY IF EXISTS "wt scoped select" ON public.work_tasks;
CREATE POLICY "wt scoped select"
  ON public.work_tasks FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.work_groups wg
      WHERE wg.id = work_tasks.group_id
        AND public.can_access_project(wg.project_id)
    )
  );

-- Project-linked content tables
DROP POLICY IF EXISTS "materials select owner or admin" ON public.materials;
DROP POLICY IF EXISTS "materials scoped select" ON public.materials;
CREATE POLICY "materials scoped select"
  ON public.materials FOR SELECT TO authenticated
  USING (public.can_access_project(project_id));

DROP POLICY IF EXISTS "materials update" ON public.materials;
DROP POLICY IF EXISTS "materials scoped update" ON public.materials;
CREATE POLICY "materials scoped update"
  ON public.materials FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR (public.has_role(auth.uid(), 'group_member'::public.app_role) AND public.can_access_project(project_id))
    OR auth.uid() = created_by
  );

DROP POLICY IF EXISTS "materials delete" ON public.materials;
DROP POLICY IF EXISTS "materials scoped delete" ON public.materials;
CREATE POLICY "materials scoped delete"
  ON public.materials FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR (public.has_role(auth.uid(), 'group_member'::public.app_role) AND public.can_access_project(project_id))
    OR auth.uid() = created_by
  );

DROP POLICY IF EXISTS "fr select" ON public.field_records;
DROP POLICY IF EXISTS "fr scoped select" ON public.field_records;
CREATE POLICY "fr scoped select" ON public.field_records FOR SELECT TO authenticated USING (public.can_access_project(project_id));

DROP POLICY IF EXISTS "mm select" ON public.meeting_minutes;
DROP POLICY IF EXISTS "mm scoped select" ON public.meeting_minutes;
CREATE POLICY "mm scoped select" ON public.meeting_minutes FOR SELECT TO authenticated USING (public.can_access_project(project_id));

DROP POLICY IF EXISTS "ma select" ON public.meeting_analyses;
DROP POLICY IF EXISTS "ma scoped select" ON public.meeting_analyses;
CREATE POLICY "ma scoped select"
  ON public.meeting_analyses FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.meeting_minutes mm
      WHERE mm.id = meeting_analyses.minute_id
        AND public.can_access_project(mm.project_id)
    )
  );

DROP POLICY IF EXISTS "mf select" ON public.meeting_files;
DROP POLICY IF EXISTS "mf scoped select" ON public.meeting_files;
CREATE POLICY "mf scoped select" ON public.meeting_files FOR SELECT TO authenticated USING (public.can_access_project(project_id));

DROP POLICY IF EXISTS "es_select" ON public.expert_scores;
DROP POLICY IF EXISTS "expert_scores scoped select" ON public.expert_scores;
CREATE POLICY "expert_scores scoped select"
  ON public.expert_scores FOR SELECT TO authenticated
  USING (public.can_access_project(project_id));

DROP POLICY IF EXISTS "ess_select" ON public.expert_score_sheets;
DROP POLICY IF EXISTS "expert_score_sheets scoped select" ON public.expert_score_sheets;
CREATE POLICY "expert_score_sheets scoped select"
  ON public.expert_score_sheets FOR SELECT TO authenticated
  USING (public.can_access_project(project_id));

DROP POLICY IF EXISTS "rt select" ON public.rectification_tasks;
DROP POLICY IF EXISTS "rectification_tasks scoped select" ON public.rectification_tasks;
CREATE POLICY "rectification_tasks scoped select"
  ON public.rectification_tasks FOR SELECT TO authenticated
  USING (public.can_access_project(project_id));

DROP POLICY IF EXISTS "ep select" ON public.evaluation_plans;
DROP POLICY IF EXISTS "evaluation_plans scoped select" ON public.evaluation_plans;
CREATE POLICY "evaluation_plans scoped select"
  ON public.evaluation_plans FOR SELECT TO authenticated
  USING (public.can_access_project(project_id));

DROP POLICY IF EXISTS "ap select" ON public.archived_projects;
DROP POLICY IF EXISTS "archived_projects scoped select" ON public.archived_projects;
CREATE POLICY "archived_projects scoped select"
  ON public.archived_projects FOR SELECT TO authenticated
  USING (public.can_access_project(project_id));

DROP POLICY IF EXISTS "Reports viewable by authenticated" ON public.reports;
DROP POLICY IF EXISTS "reports scoped select" ON public.reports;
CREATE POLICY "reports scoped select"
  ON public.reports FOR SELECT TO authenticated
  USING (public.can_access_project(project_id));

DROP POLICY IF EXISTS "rv select" ON public.report_versions;
DROP POLICY IF EXISTS "report_versions scoped select" ON public.report_versions;
CREATE POLICY "report_versions scoped select"
  ON public.report_versions FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.reports r
      WHERE r.id = report_versions.report_id
        AND public.can_access_project(r.project_id)
    )
  );

DROP POLICY IF EXISTS "knowledge files select" ON public.knowledge_files;
DROP POLICY IF EXISTS "knowledge_files scoped select" ON public.knowledge_files;
CREATE POLICY "knowledge_files scoped select"
  ON public.knowledge_files FOR SELECT TO authenticated
  USING (project_id IS NULL OR public.can_access_project(project_id));

DROP POLICY IF EXISTS "knowledge chunks select" ON public.knowledge_chunks;
DROP POLICY IF EXISTS "knowledge_chunks scoped select" ON public.knowledge_chunks;
CREATE POLICY "knowledge_chunks scoped select"
  ON public.knowledge_chunks FOR SELECT TO authenticated
  USING (project_id IS NULL OR public.can_access_project(project_id));

DROP POLICY IF EXISTS "mi select" ON public.material_indicators;
DROP POLICY IF EXISTS "material_indicators scoped select" ON public.material_indicators;
CREATE POLICY "material_indicators scoped select"
  ON public.material_indicators FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.materials m
      WHERE m.id = material_indicators.material_id
        AND public.can_access_project(m.project_id)
    )
  );

DROP POLICY IF EXISTS "fp select" ON public.field_photos;
DROP POLICY IF EXISTS "field_photos scoped select" ON public.field_photos;
CREATE POLICY "field_photos scoped select"
  ON public.field_photos FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.field_records fr
      WHERE fr.id = field_photos.record_id
        AND public.can_access_project(fr.project_id)
    )
  );

DROP POLICY IF EXISTS "fs select owner or admin" ON public.field_signatures;
DROP POLICY IF EXISTS "field_signatures scoped select" ON public.field_signatures;
CREATE POLICY "field_signatures scoped select"
  ON public.field_signatures FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.field_records fr
      WHERE fr.id = field_signatures.record_id
        AND public.can_access_project(fr.project_id)
    )
  );
