-- 一个项目在项目库里只应有一条记录：定稿后自动入库，再次定稿则更新同一条，
-- 而不是堆出多条历史。没有唯一约束就无法用 upsert 表达这个语义。
DELETE FROM public.archived_projects a
USING public.archived_projects b
WHERE a.project_id = b.project_id
  AND a.archived_at < b.archived_at;

ALTER TABLE public.archived_projects
  DROP CONSTRAINT IF EXISTS archived_projects_project_unique;
ALTER TABLE public.archived_projects
  ADD CONSTRAINT archived_projects_project_unique UNIQUE (project_id);
