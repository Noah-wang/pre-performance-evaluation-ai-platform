CREATE OR REPLACE FUNCTION public.get_user_directory()
RETURNS TABLE (
  user_id uuid,
  email text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT u.id AS user_id, u.email::text AS email
  FROM auth.users u
  WHERE public.has_role(auth.uid(), 'admin'::public.app_role)
  ORDER BY u.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_user_directory() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_directory() TO authenticated;
