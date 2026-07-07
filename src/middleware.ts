import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_NAME, expectedToken } from "@/lib/auth.js";

/**
 * Gate every route behind the shared password. Disabled automatically if
 * APP_PASSWORD is unset (e.g. a dev without the gate). Login page and auth
 * routes are excluded via the matcher below.
 */
export async function middleware(req: NextRequest) {
  const expected = await expectedToken();
  if (!expected) return NextResponse.next(); // gate off when no password set

  // Vercel Cron authenticates with `Authorization: Bearer ${CRON_SECRET}`.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.get("authorization") === `Bearer ${cronSecret}`) {
    return NextResponse.next();
  }

  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (token === expected) return NextResponse.next();

  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  // /terms and /privacy stay public: Intuit's app review must reach them.
  matcher: ["/((?!login|terms|privacy|api/auth|_next/static|_next/image|favicon.ico).*)"],
};
