ALTER TABLE public.field_records 
ADD COLUMN IF NOT EXISTS gps_lng numeric,
ADD COLUMN IF NOT EXISTS gps_lat numeric,
ADD COLUMN IF NOT EXISTS gps_accuracy numeric;