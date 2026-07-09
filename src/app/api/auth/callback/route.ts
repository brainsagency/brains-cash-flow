import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server.js";
import { isAllowedEmail } from "@/lib/auth.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * OAuth return leg. Supabase sends the user here with a `code` after Google
 * sign-in. We exchange it for a session, then enforce the allowlist: an account
 * that isn't allowed is signed straight back out so no usable session lingers.
 */
export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createSupabaseServer();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (isAllowedEmail(user?.email)) {
        return NextResponse.redirect(`${origin}${next.startsWith("/") ? next : "/"}`);
      }
      await supabase.auth.signOut();
      return NextResponse.redirect(`${origin}/login?error=denied`);
    }
  }
  return NextResponse.redirect(`${origin}/login?error=auth`);
}
