-- Trigger function: write a material notification when status becomes missing/rejected
CREATE OR REPLACE FUNCTION public.notify_material_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project_name TEXT;
  v_severity TEXT;
  v_title TEXT;
  v_body TEXT;
  v_dedupe TEXT;
  v_action TEXT;
BEGIN
  -- Only act when status is missing or rejected
  IF NEW.status NOT IN ('missing', 'rejected') THEN
    RETURN NEW;
  END IF;

  -- On UPDATE, only fire when status actually changed into missing/rejected
  IF TG_OP = 'UPDATE' AND OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  -- Skip non-required materials for noise reduction (still notify on rejection regardless)
  IF NEW.required = false AND NEW.status = 'missing' THEN
    RETURN NEW;
  END IF;

  SELECT name INTO v_project_name FROM public.projects WHERE id = NEW.project_id;
  IF v_project_name IS NULL THEN
    v_project_name := '未知项目';
  END IF;

  IF NEW.status = 'rejected' THEN
    v_severity := 'danger';
    v_action := '资料被驳回';
    v_title := '资料被驳回：' || NEW.name;
    v_body := '项目「' || v_project_name || '」的资料「' || NEW.name || '」已被驳回'
              || COALESCE('，原因：' || NEW.review_note, '') || '，请尽快处理。';
  ELSE
    v_severity := 'warning';
    v_action := '资料缺失';
    v_title := '资料待补齐：' || NEW.name;
    v_body := '项目「' || v_project_name || '」的资料「' || NEW.name || '」状态为缺失，请及时上传。';
  END IF;

  -- Dedupe per material per status per day
  v_dedupe := 'material_status:' || NEW.id || ':' || NEW.status;

  BEGIN
    INSERT INTO public.notifications (
      user_id, category, severity, title, body, link, ref_table, ref_id, dedupe_key
    ) VALUES (
      NEW.created_by, 'material', v_severity, v_title, v_body,
      '/materials', 'materials', NEW.id, v_dedupe
    );
  EXCEPTION WHEN unique_violation THEN
    -- Already notified today, ignore
    NULL;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_material_status_notify_ins ON public.materials;
DROP TRIGGER IF EXISTS trg_material_status_notify_upd ON public.materials;

CREATE TRIGGER trg_material_status_notify_ins
AFTER INSERT ON public.materials
FOR EACH ROW
EXECUTE FUNCTION public.notify_material_status_change();

CREATE TRIGGER trg_material_status_notify_upd
AFTER UPDATE OF status ON public.materials
FOR EACH ROW
EXECUTE FUNCTION public.notify_material_status_change();