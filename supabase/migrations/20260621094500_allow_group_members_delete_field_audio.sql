-- Field research is collaborative: group members must be able to remove
-- recordings created by another member of the same internal workspace.
DROP POLICY IF EXISTS "fa delete" ON public.field_audios;
CREATE POLICY "fa delete"
ON public.field_audios
FOR DELETE
TO authenticated
USING (
  auth.uid() = created_by
  OR public.has_role(auth.uid(), 'group_member'::public.app_role)
  OR public.has_role(auth.uid(), 'admin'::public.app_role)
);

DROP POLICY IF EXISTS "field-audios owner delete" ON storage.objects;
CREATE POLICY "field-audios owner delete"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'field-audios'
  AND (
    auth.uid()::text = (storage.foldername(name))[1]
    OR public.has_role(auth.uid(), 'group_member'::public.app_role)
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
  )
);

-- Generated transcript files live in project-materials under the uploader's
-- user folder, so group members need matching cleanup permission.
DROP POLICY IF EXISTS "pm own delete" ON storage.objects;
CREATE POLICY "pm own delete"
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

DROP POLICY IF EXISTS "materials delete" ON public.materials;
CREATE POLICY "materials delete"
ON public.materials
FOR DELETE
TO authenticated
USING (
  auth.uid() = created_by
  OR public.has_role(auth.uid(), 'group_member'::public.app_role)
  OR public.has_role(auth.uid(), 'admin'::public.app_role)
);
