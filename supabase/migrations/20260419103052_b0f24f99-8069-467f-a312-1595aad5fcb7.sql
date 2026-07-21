-- ============ 1. EXPERTS：拆分公开视图 + 收紧基表 ============
DROP POLICY IF EXISTS "Experts viewable by authenticated" ON public.experts;

CREATE POLICY "Experts owner or admin full select"
  ON public.experts FOR SELECT TO authenticated
  USING (auth.uid() = created_by OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE OR REPLACE VIEW public.experts_public
WITH (security_invoker = on) AS
SELECT id, name, expert_type, organization, title, specialty, available, created_at
FROM public.experts;

GRANT SELECT ON public.experts_public TO authenticated;

-- 允许所有登录用户读取公开视图所需的非敏感字段（通过新策略）
CREATE POLICY "Experts public fields viewable"
  ON public.experts FOR SELECT TO authenticated
  USING (true);

-- 上面那条会让全表可见。改用更严格方案：删除宽松策略，仅保留 owner/admin
DROP POLICY "Experts public fields viewable" ON public.experts;

-- 创建安全函数让前端可获取脱敏专家列表（含全部记录但不含 phone/email）
CREATE OR REPLACE FUNCTION public.get_experts_public()
RETURNS TABLE (
  id uuid, name text, expert_type text, organization text,
  title text, specialty text, available boolean, created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT id, name, expert_type, organization, title, specialty, available, created_at
  FROM public.experts
  ORDER BY created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_experts_public() TO authenticated;

-- ============ 2. PROFILES：电话仅本人/admin ============
DROP POLICY IF EXISTS "Profiles viewable by authenticated" ON public.profiles;

CREATE POLICY "Profiles owner or admin full select"
  ON public.profiles FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::app_role));

-- 提供脱敏函数（不含 phone）供需要展示成员名单的页面使用
CREATE OR REPLACE FUNCTION public.get_profiles_public()
RETURNS TABLE (
  user_id uuid, display_name text, organization text, created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT user_id, display_name, organization, created_at FROM public.profiles;
$$;

GRANT EXECUTE ON FUNCTION public.get_profiles_public() TO authenticated;

-- ============ 3. FIELD_SIGNATURES：签字图像仅创建人/admin ============
DROP POLICY IF EXISTS "fs select" ON public.field_signatures;

CREATE POLICY "fs select owner or admin"
  ON public.field_signatures FOR SELECT TO authenticated
  USING (auth.uid() = created_by OR public.has_role(auth.uid(), 'admin'::app_role));

-- ============ 4. MATERIALS：审核备注仅创建人/admin 可见全部字段 ============
DROP POLICY IF EXISTS "materials select" ON public.materials;

CREATE POLICY "materials select owner or admin"
  ON public.materials FOR SELECT TO authenticated
  USING (auth.uid() = created_by OR public.has_role(auth.uid(), 'admin'::app_role));

-- 提供脱敏函数供其他用户查看资料清单（不含 review_note）
CREATE OR REPLACE FUNCTION public.get_materials_public(_project_id uuid)
RETURNS TABLE (
  id uuid, project_id uuid, name text, category text, required boolean,
  status text, file_path text, file_name text, created_at timestamptz, updated_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT id, project_id, name, category, required, status, file_path, file_name, created_at, updated_at
  FROM public.materials
  WHERE project_id = _project_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_materials_public(uuid) TO authenticated;

-- ============ 5. FIELD-PHOTOS 存储桶：改为私有 ============
UPDATE storage.buckets SET public = false WHERE id = 'field-photos';

-- 现场照片存储策略：登录用户可读，本人/admin 可写删
DROP POLICY IF EXISTS "field-photos public read" ON storage.objects;
DROP POLICY IF EXISTS "field-photos auth read" ON storage.objects;
DROP POLICY IF EXISTS "field-photos auth insert" ON storage.objects;
DROP POLICY IF EXISTS "field-photos owner delete" ON storage.objects;

CREATE POLICY "field-photos auth read"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'field-photos');

CREATE POLICY "field-photos auth insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'field-photos' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "field-photos owner delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'field-photos'
    AND (auth.uid()::text = (storage.foldername(name))[1] OR public.has_role(auth.uid(), 'admin'::app_role))
  );

-- ============ 6. STORAGE.BUCKETS：禁止匿名列出存储桶 ============
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='buckets' AND policyname='Authenticated users can list buckets'
  ) THEN
    EXECUTE 'CREATE POLICY "Authenticated users can list buckets" ON storage.buckets FOR SELECT TO authenticated USING (true)';
  END IF;
END $$;