-- Migration 057: Security Hardening RLS Phase 1 (DESIGN ONLY)
-- DO NOT APPLY TO PRODUCTION OR STAGING YET

-- Enable RLS on Registration flow tables
ALTER TABLE public.event_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_registrations ENABLE ROW LEVEL SECURITY;

-- 1. EVENT LINKS POLICIES
-- Drop existing policies if any
DROP POLICY IF EXISTS "event_links_admin_select" ON public.event_links;
DROP POLICY IF EXISTS "event_links_anon_deny" ON public.event_links;

-- Allow Admins to SELECT
CREATE POLICY "event_links_admin_select" ON public.event_links
FOR SELECT TO authenticated
USING (public.is_active_admin());

-- Explicit Deny for ANON (Defense in depth)
-- Note: Service Role bypasses RLS automatically. Server Actions will still work perfectly.
CREATE POLICY "event_links_anon_deny" ON public.event_links
FOR ALL TO anon
USING (false);

-- 2. EVENT REGISTRATIONS POLICIES
DROP POLICY IF EXISTS "event_registrations_admin_select" ON public.event_registrations;
DROP POLICY IF EXISTS "event_registrations_anon_deny" ON public.event_registrations;

CREATE POLICY "event_registrations_admin_select" ON public.event_registrations
FOR SELECT TO authenticated
USING (public.is_active_admin());

CREATE POLICY "event_registrations_anon_deny" ON public.event_registrations
FOR ALL TO anon
USING (false);

-- 3. LEAKED PASSWORD / ANON EXECUTE REVOKE
-- Revoke execute on sensitive helper functions from anon, public
REVOKE EXECUTE ON FUNCTION public.current_admin_context() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.is_active_admin() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.admin_can_access_season(text) FROM anon, public;

-- Explicitly GRANT execute to authenticated (Admin users using the portal)
GRANT EXECUTE ON FUNCTION public.current_admin_context() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_active_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_can_access_season(text) TO authenticated;
