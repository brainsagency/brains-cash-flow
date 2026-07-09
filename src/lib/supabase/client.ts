/**
 * Browser-side Supabase client for the login page. Uses the public anon key
 * and the SSR cookie storage so the session it establishes is readable by the
 * server (middleware + route handlers).
 */

import { createBrowserClient } from "@supabase/ssr";

export function createSupabaseBrowser() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
