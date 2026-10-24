import { NextResponse } from "next/server";
import { SESSION_COOKIE, SESSION_MAX_AGE, safeEqual, sessionToken } from "@/lib/auth";

export async function POST(request: Request) {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) return NextResponse.json({ ok: true });

  let submitted = "";
  try {
    const body = (await request.json()) as { password?: string };
    submitted = String(body.password || "");
  } catch {}

  const expected = await sessionToken(password);
  const given = await sessionToken(submitted);
  if (!safeEqual(given, expected)) {
    // Léger délai pour ralentir les essais successifs.
    await new Promise((r) => setTimeout(r, 600));
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, expected, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}
