-- report_versions
CREATE TABLE public.report_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL,
  version_no integer NOT NULL,
  title text NOT NULL,
  content text,
  change_summary text,
  source text NOT NULL DEFAULT 'manual',
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(report_id, version_no)
);
CREATE INDEX idx_report_versions_report ON public.report_versions(report_id, version_no DESC);
ALTER TABLE public.report_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rv select" ON public.report_versions FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.reports r WHERE r.id = report_versions.report_id AND (r.created_by = auth.uid() OR has_role(auth.uid(),'admin'::app_role))));
CREATE POLICY "rv insert" ON public.report_versions FOR INSERT TO authenticated
WITH CHECK (auth.uid() = created_by AND EXISTS (SELECT 1 FROM public.reports r WHERE r.id = report_versions.report_id AND (r.created_by = auth.uid() OR has_role(auth.uid(),'admin'::app_role))));
CREATE POLICY "rv delete" ON public.report_versions FOR DELETE TO authenticated
USING (auth.uid() = created_by OR has_role(auth.uid(),'admin'::app_role));

-- share_links
CREATE TABLE public.share_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL,
  token text NOT NULL UNIQUE,
  password_hash text,
  expires_at timestamptz,
  max_views integer,
  view_count integer NOT NULL DEFAULT 0,
  watermark_required boolean NOT NULL DEFAULT true,
  scope text NOT NULL DEFAULT 'full',
  revoked boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_share_links_token ON public.share_links(token);
ALTER TABLE public.share_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sl select" ON public.share_links FOR SELECT TO authenticated
USING (auth.uid() = created_by OR has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "sl insert" ON public.share_links FOR INSERT TO authenticated
WITH CHECK (auth.uid() = created_by);
CREATE POLICY "sl update" ON public.share_links FOR UPDATE TO authenticated
USING (auth.uid() = created_by OR has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "sl delete" ON public.share_links FOR DELETE TO authenticated
USING (auth.uid() = created_by OR has_role(auth.uid(),'admin'::app_role));

-- share_link_views (audit)
CREATE TABLE public.share_link_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  share_link_id uuid NOT NULL,
  viewed_at timestamptz NOT NULL DEFAULT now(),
  ip text,
  user_agent text,
  success boolean NOT NULL DEFAULT true,
  reason text
);
CREATE INDEX idx_slv_share ON public.share_link_views(share_link_id, viewed_at DESC);
ALTER TABLE public.share_link_views ENABLE ROW LEVEL SECURITY;

CREATE POLICY "slv select owner" ON public.share_link_views FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.share_links s WHERE s.id = share_link_views.share_link_id AND (s.created_by = auth.uid() OR has_role(auth.uid(),'admin'::app_role))));

-- verify_share_link RPC
CREATE OR REPLACE FUNCTION public.verify_share_link(_token text, _pwd text, _ip text DEFAULT NULL, _ua text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  link record;
  rep record;
  ok boolean := false;
  reason text := NULL;
BEGIN
  SELECT * INTO link FROM public.share_links WHERE token = _token LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF link.revoked THEN reason := 'revoked';
  ELSIF link.expires_at IS NOT NULL AND link.expires_at < now() THEN reason := 'expired';
  ELSIF link.max_views IS NOT NULL AND link.view_count >= link.max_views THEN reason := 'exhausted';
  ELSIF link.password_hash IS NOT NULL AND (extensions.crypt(COALESCE(_pwd,''), link.password_hash) <> link.password_hash) THEN reason := 'bad_password';
  ELSE ok := true;
  END IF;

  INSERT INTO public.share_link_views(share_link_id, ip, user_agent, success, reason)
  VALUES (link.id, _ip, _ua, ok, reason);

  IF NOT ok THEN
    RETURN jsonb_build_object('ok', false, 'error', reason);
  END IF;

  UPDATE public.share_links SET view_count = view_count + 1 WHERE id = link.id;
  SELECT id, title, content, conclusion INTO rep FROM public.reports WHERE id = link.report_id;

  RETURN jsonb_build_object(
    'ok', true,
    'report', jsonb_build_object('id', rep.id, 'title', rep.title, 'content', rep.content, 'conclusion', rep.conclusion),
    'watermark', link.watermark_required,
    'scope', link.scope
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_share_link(text,text,text,text) TO anon, authenticated;