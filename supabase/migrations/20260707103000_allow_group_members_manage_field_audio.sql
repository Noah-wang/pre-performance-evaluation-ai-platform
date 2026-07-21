-- 现场调研录音需要支持协作账号共同播放、转写和维护。
DROP POLICY IF EXISTS "fa update" ON public.field_audios;
CREATE POLICY "fa update"
ON public.field_audios
FOR UPDATE
TO authenticated
USING (
  auth.uid() = created_by
  OR public.has_role(auth.uid(), 'group_member'::public.app_role)
  OR public.has_role(auth.uid(), 'admin'::public.app_role)
);

DROP POLICY IF EXISTS "field-audios owner read" ON storage.objects;
CREATE POLICY "field-audios owner read"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'field-audios'
  AND (
    auth.uid()::text = (storage.foldername(name))[1]
    OR public.has_role(auth.uid(), 'group_member'::public.app_role)
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
  )
);

DROP POLICY IF EXISTS "field-audios owner update" ON storage.objects;
CREATE POLICY "field-audios owner update"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'field-audios'
  AND (
    auth.uid()::text = (storage.foldername(name))[1]
    OR public.has_role(auth.uid(), 'group_member'::public.app_role)
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
  )
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
