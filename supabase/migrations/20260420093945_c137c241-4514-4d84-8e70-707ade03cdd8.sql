CREATE TABLE public.app_errors (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID,
  scope       TEXT,
  message     TEXT NOT NULL,
  stack       TEXT,
  url         TEXT,
  route       TEXT,
  user_agent  TEXT,
  meta        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_app_errors_created_at ON public.app_errors (created_at DESC);
CREATE INDEX idx_app_errors_user_id    ON public.app_errors (user_id);
CREATE INDEX idx_app_errors_route      ON public.app_errors (route);

ALTER TABLE public.app_errors ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated may write their own error rows (or anonymous null user_id)
CREATE POLICY "anyone insert errors"
  ON public.app_errors
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id IS NULL OR user_id = auth.uid());

-- Only admins can read
CREATE POLICY "admins read errors"
  ON public.app_errors
  FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Only admins can delete
CREATE POLICY "admins delete errors"
  ON public.app_errors
  FOR DELETE
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));