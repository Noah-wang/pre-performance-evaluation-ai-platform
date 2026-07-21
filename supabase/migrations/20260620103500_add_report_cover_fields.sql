ALTER TABLE public.reports
ADD COLUMN IF NOT EXISTS supervising_department text,
ADD COLUMN IF NOT EXISTS evaluation_org text,
ADD COLUMN IF NOT EXISTS third_party_org text;
