/**
 * Server-side Supabase auth client (anon key + user session cookies) for route
 * handlers and server components. This is the *auth* client — distinct from the
 * service_role client in `integrations/supabase.ts`, which is for data storage
 * and must never touch user sessions.
 */

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createSupabaseServer() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // `set` throws when called from a Server Component render; the
            // middleware refreshes the session cookie instead, so this is safe
            // to ignore.
          }
        },
      },
    },
  );
}
