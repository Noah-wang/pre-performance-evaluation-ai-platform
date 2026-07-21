-- 1. audit_logs table
CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid,
  actor_email text,
  table_name text NOT NULL,
  record_id uuid,
  action text NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE')),
  old_data jsonb,
  new_data jsonb,
  changed_fields text[],
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_logs_table_record ON public.audit_logs(table_name, record_id);
CREATE INDEX idx_audit_logs_actor ON public.audit_logs(actor_id);
CREATE INDEX idx_audit_logs_created ON public.audit_logs(created_at DESC);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read audit logs" ON public.audit_logs
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins delete audit logs" ON public.audit_logs
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 2. Trigger function
CREATE OR REPLACE FUNCTION public.log_audit_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_email text;
  v_record_id uuid;
  v_old jsonb;
  v_new jsonb;
  v_changed text[];
  v_key text;
BEGIN
  BEGIN
    SELECT email INTO v_email FROM auth.users WHERE id = v_actor;
  EXCEPTION WHEN OTHERS THEN
    v_email := NULL;
  END;

  IF TG_OP = 'DELETE' THEN
    v_old := to_jsonb(OLD);
    v_record_id := (v_old->>'id')::uuid;
  ELSIF TG_OP = 'INSERT' THEN
    v_new := to_jsonb(NEW);
    v_record_id := (v_new->>'id')::uuid;
  ELSE
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
    v_record_id := (v_new->>'id')::uuid;
    v_changed := ARRAY(
      SELECT key FROM jsonb_each(v_new)
      WHERE v_new->key IS DISTINCT FROM v_old->key
        AND key NOT IN ('updated_at','created_at')
    );
    -- skip noise: nothing meaningful changed
    IF array_length(v_changed, 1) IS NULL THEN
      RETURN NEW;
    END IF;
  END IF;

  INSERT INTO public.audit_logs(
    actor_id, actor_email, table_name, record_id, action, old_data, new_data, changed_fields
  ) VALUES (
    v_actor, v_email, TG_TABLE_NAME, v_record_id, TG_OP, v_old, v_new, v_changed
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- 3. Attach to core tables
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'projects','experts','reports','expert_scores','materials',
    'evaluation_packages','work_groups','work_tasks','user_roles'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS audit_%I ON public.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER audit_%I AFTER INSERT OR UPDATE OR DELETE ON public.%I
       FOR EACH ROW EXECUTE FUNCTION public.log_audit_event()',
      t, t
    );
  END LOOP;
END $$;