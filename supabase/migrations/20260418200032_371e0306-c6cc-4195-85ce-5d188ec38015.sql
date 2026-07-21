
-- 工作组
CREATE TABLE public.work_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  leader TEXT,
  formed_on DATE NOT NULL DEFAULT CURRENT_DATE,
  notes TEXT,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.work_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wg select" ON public.work_groups FOR SELECT TO authenticated USING (true);
CREATE POLICY "wg insert" ON public.work_groups FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY "wg update" ON public.work_groups FOR UPDATE TO authenticated USING (auth.uid() = created_by OR has_role(auth.uid(),'admin'));
CREATE POLICY "wg delete" ON public.work_groups FOR DELETE TO authenticated USING (auth.uid() = created_by OR has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_wg_updated BEFORE UPDATE ON public.work_groups FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 工作组成员
CREATE TABLE public.work_group_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.work_groups(id) ON DELETE CASCADE,
  member_name TEXT NOT NULL,
  member_role TEXT NOT NULL DEFAULT 'member',
  organization TEXT,
  contact TEXT,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.work_group_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wgm select" ON public.work_group_members FOR SELECT TO authenticated USING (true);
CREATE POLICY "wgm insert" ON public.work_group_members FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY "wgm update" ON public.work_group_members FOR UPDATE TO authenticated USING (auth.uid() = created_by OR has_role(auth.uid(),'admin'));
CREATE POLICY "wgm delete" ON public.work_group_members FOR DELETE TO authenticated USING (auth.uid() = created_by OR has_role(auth.uid(),'admin'));

-- 任务计划
CREATE TABLE public.work_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.work_groups(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  assignee TEXT,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  completed_on DATE,
  status TEXT NOT NULL DEFAULT 'todo',
  notes TEXT,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.work_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wt select" ON public.work_tasks FOR SELECT TO authenticated USING (true);
CREATE POLICY "wt insert" ON public.work_tasks FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY "wt update" ON public.work_tasks FOR UPDATE TO authenticated USING (auth.uid() = created_by OR has_role(auth.uid(),'admin'));
CREATE POLICY "wt delete" ON public.work_tasks FOR DELETE TO authenticated USING (auth.uid() = created_by OR has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_wt_updated BEFORE UPDATE ON public.work_tasks FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_wgm_group ON public.work_group_members(group_id);
CREATE INDEX idx_wt_group ON public.work_tasks(group_id);
CREATE INDEX idx_wg_project ON public.work_groups(project_id);
