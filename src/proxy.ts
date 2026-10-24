import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, safeEqual, sessionToken } from "@/lib/auth";

// Toutes les pages passent par ici ; sans session valide, renvoi vers /login.
// Restent publics : la connexion, la réception des visites et des webhooks (protégés par leur propre secret)
// et le script de suivi servi au site.
export async function proxy(request: NextRequest) {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) return NextResponse.next();

  const cookie = request.cookies.get(SESSION_COOKIE)?.value || "";
  if (cookie && safeEqual(cookie, await sessionToken(password))) return NextResponse.next();

  const url = request.nextUrl.clone();
  const next = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  url.pathname = "/login";
  url.search = next && next !== "/" ? `?next=${encodeURIComponent(next)}` : "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!login|api/login|api/visite|api/webhook|api/cron|t\\.js|_next/static|_next/image|favicon.ico|icon\.svg|robots.txt).*)"],
};
