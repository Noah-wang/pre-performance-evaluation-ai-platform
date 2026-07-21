-- Lock core business writes to admin accounts only.
-- Use RESTRICTIVE policies so existing permissive policies remain readable
-- but all INSERT / UPDATE / DELETE now additionally require admin role.

DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    'projects',
    'experts',
    'reports',
    'evaluation_packages',
    'evaluation_systems',
    'evaluation_indicators',
    'evaluation_plans',
    'work_groups',
    'work_group_members',
    'work_tasks',
    'materials',
    'material_indicators',
    'field_records',
    'field_photos',
    'field_signatures',
    'field_audios',
    'meeting_minutes',
    'meeting_analyses',
    'meeting_files',
    'expert_scores',
    'expert_score_sheets',
    'goal_library',
    'rectification_tasks',
    'report_versions',
    'share_links'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_admin_only_insert', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_admin_only_update', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_admin_only_delete', tbl);

    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), ''admin''::public.app_role))',
      tbl || '_admin_only_insert',
      tbl
    );

    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), ''admin''::public.app_role)) WITH CHECK (public.has_role(auth.uid(), ''admin''::public.app_role))',
      tbl || '_admin_only_update',
      tbl
    );

    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING (public.has_role(auth.uid(), ''admin''::public.app_role))',
      tbl || '_admin_only_delete',
      tbl
    );
  END LOOP;
END $$;
