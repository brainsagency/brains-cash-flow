import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_NAME, expectedToken, tokenFor } from "@/lib/auth.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const expected = await expectedToken();
  if (!expected) return NextResponse.json({ ok: true }); // gate disabled

  let password = "";
  try {
    const body = (await req.json()) as { password?: string };
    password = String(body.password ?? "");
  } catch {
    /* no/invalid body */
  }

  if ((await tokenFor(password)) !== expected) {
    return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, expected, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
  return res;
}
