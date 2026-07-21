ALTER TABLE public.field_photos
  ADD COLUMN IF NOT EXISTS exif_json jsonb,
  ADD COLUMN IF NOT EXISTS watermarked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS gps_lng numeric,
  ADD COLUMN IF NOT EXISTS gps_lat numeric,
  ADD COLUMN IF NOT EXISTS taken_at timestamptz;

ALTER TABLE public.field_audios
  ADD COLUMN IF NOT EXISTS segment_index integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS segment_total integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS parent_audio_id uuid;