import { createClient } from "@supabase/supabase-js";

// Server-only client using the service role key. Bypasses RLS.
// Used by API routes for bulk imports and user management.
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
