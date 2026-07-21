-- Fix collaboration issues for project association, materials upload, and
-- shared access to archived project documents.

-- 1) Projects: non-expert authenticated users should be able to maintain
-- project metadata, including binding an evaluation system.
DROP POLICY IF EXISTS "Owners or admins update projects" ON public.projects;
DROP POLICY IF EXISTS "Owners or admins delete projects" ON public.projects;

CREATE POLICY "Projects maintainable by members"
  ON public.projects
  FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = created_by
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'group_member'::public.app_role)
    OR NOT public.has_role(auth.uid(), 'expert'::public.app_role)
  );

CREATE POLICY "Projects deletable by members"
  ON public.projects
  FOR DELETE
  TO authenticated
  USING (
    auth.uid() = created_by
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'group_member'::public.app_role)
    OR NOT public.has_role(auth.uid(), 'expert'::public.app_role)
  );

-- 2) Materials: pending rows are often created by a different operator.
-- Allow internal members to upload/review/delete within the shared workflow.
DROP POLICY IF EXISTS "materials update" ON public.materials;
DROP POLICY IF EXISTS "materials delete" ON public.materials;

CREATE POLICY "materials update"
  ON public.materials
  FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = created_by
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'group_member'::public.app_role)
    OR NOT public.has_role(auth.uid(), 'expert'::public.app_role)
  );

CREATE POLICY "materials delete"
  ON public.materials
  FOR DELETE
  TO authenticated
  USING (
    auth.uid() = created_by
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'group_member'::public.app_role)
    OR NOT public.has_role(auth.uid(), 'expert'::public.app_role)
  );

-- 3) Project materials bucket: shared read for authenticated users so that
-- collaborators can preview/download files uploaded by other members.
-- Keep insert owner-scoped; allow group members/admins to help remove bad files.
DROP POLICY IF EXISTS "pm own select" ON storage.objects;
DROP POLICY IF EXISTS "pm own insert" ON storage.objects;
DROP POLICY IF EXISTS "pm own delete" ON storage.objects;

CREATE POLICY "pm auth select"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (bucket_id = 'project-materials');

CREATE POLICY "pm own insert"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'project-materials'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "pm member delete"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'project-materials'
    AND (
      auth.uid()::text = (storage.foldername(name))[1]
      OR public.has_role(auth.uid(), 'group_member'::public.app_role)
      OR public.has_role(auth.uid(), 'admin'::public.app_role)
    )
  );
