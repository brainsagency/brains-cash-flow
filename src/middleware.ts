import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware.js";
import { isAllowedEmail } from "@/lib/auth.js";

/**
 * Gate every route behind Google SSO (Supabase Auth). A request is allowed only
 * if it carries a valid Supabase session whose email is on the allowlist
 * (AUTH_ALLOWED_EMAILS). Login page, auth routes, and the legal pages are
 * excluded via the matcher below.
 */
export async function middleware(req: NextRequest) {
  // Vercel Cron authenticates with `Authorization: Bearer ${CRON_SECRET}` — it
  // has no browser session, so let it through before the auth check.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.get("authorization") === `Bearer ${cronSecret}`) {
    return NextResponse.next();
  }

  const { response, user } = await updateSession(req);
  if (user && isAllowedEmail(user.email)) return response; // refreshed-cookie response

  // Signed out, or signed in with a non-allowlisted account.
  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = user ? "error=denied" : "";
  return NextResponse.redirect(url);
}

export const config = {
  // /terms and /privacy stay public: Intuit's app review must reach them.
  // /api/auth holds the OAuth callback + logout.
  matcher: ["/((?!login|terms|privacy|api/auth|_next/static|_next/image|favicon.ico).*)"],
};
