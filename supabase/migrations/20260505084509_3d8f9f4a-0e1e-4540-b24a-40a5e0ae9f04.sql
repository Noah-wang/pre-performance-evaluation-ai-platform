CREATE OR REPLACE FUNCTION public.create_share_link(
  _report_id uuid,
  _password text,
  _expires_at timestamptz,
  _max_views integer,
  _watermark boolean,
  _scope text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  _token text;
  _hash text;
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.reports r WHERE r.id = _report_id AND (r.created_by = _uid OR has_role(_uid,'admin'::app_role))) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  _token := encode(extensions.gen_random_bytes(16), 'hex');
  IF _password IS NOT NULL AND length(_password) > 0 THEN
    _hash := extensions.crypt(_password, extensions.gen_salt('bf'));
  END IF;
  INSERT INTO public.share_links(report_id, token, password_hash, expires_at, max_views, watermark_required, scope, created_by)
  VALUES (_report_id, _token, _hash, _expires_at, _max_views, COALESCE(_watermark, true), COALESCE(_scope,'full'), _uid);
  RETURN jsonb_build_object('token', _token);
END;
$$;
GRANT EXECUTE ON FUNCTION public.create_share_link(uuid,text,timestamptz,integer,boolean,text) TO authenticated;