import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_NAME } from "@/lib/auth.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  const res = NextResponse.redirect(new URL("/login", req.url));
  res.cookies.delete(COOKIE_NAME);
  return res;
}
