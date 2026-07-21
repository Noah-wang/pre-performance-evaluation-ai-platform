ALTER TABLE public.reports
ADD COLUMN IF NOT EXISTS unsupported_budget numeric,
ADD COLUMN IF NOT EXISTS supported_budget numeric,
ADD COLUMN IF NOT EXISTS summary_remark text;
