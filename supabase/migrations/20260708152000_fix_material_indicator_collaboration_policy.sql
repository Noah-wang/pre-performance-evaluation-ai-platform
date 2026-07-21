-- Allow collaborators to maintain material-indicator links when materials are
-- created by another internal operator.

DROP POLICY IF EXISTS "mi select" ON public.material_indicators;
DROP POLICY IF EXISTS "mi insert" ON public.material_indicators;
DROP POLICY IF EXISTS "mi delete" ON public.material_indicators;

CREATE POLICY "mi select"
  ON public.material_indicators
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.materials m
      WHERE m.id = material_indicators.material_id
        AND (
          m.created_by = auth.uid()
          OR public.has_role(auth.uid(), 'admin'::public.app_role)
          OR public.has_role(auth.uid(), 'group_member'::public.app_role)
          OR NOT public.has_role(auth.uid(), 'expert'::public.app_role)
        )
    )
  );

CREATE POLICY "mi insert"
  ON public.material_indicators
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = created_by
    AND EXISTS (
      SELECT 1
      FROM public.materials m
      WHERE m.id = material_id
        AND (
          m.created_by = auth.uid()
          OR public.has_role(auth.uid(), 'admin'::public.app_role)
          OR public.has_role(auth.uid(), 'group_member'::public.app_role)
          OR NOT public.has_role(auth.uid(), 'expert'::public.app_role)
        )
    )
  );

CREATE POLICY "mi delete"
  ON public.material_indicators
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.materials m
      WHERE m.id = material_indicators.material_id
        AND (
          m.created_by = auth.uid()
          OR public.has_role(auth.uid(), 'admin'::public.app_role)
          OR public.has_role(auth.uid(), 'group_member'::public.app_role)
          OR NOT public.has_role(auth.uid(), 'expert'::public.app_role)
        )
    )
  );
