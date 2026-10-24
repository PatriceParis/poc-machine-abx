import { NextResponse } from "next/server";
import { requete } from "@/lib/db";
import { safeEqual } from "@/lib/auth";

// Réception brute des webhooks (Brevo, ReachMCP, formulaire du test, LinkedIn). Rien n'est interprété ici :
// tout est rangé tel quel, puis interprété quand le format réel est connu. Secret obligatoire, dans
// l'en-tête x-cle ou le paramètre ?cle=.
const SOURCES = new Set(["brevo", "reachmcp", "test", "linkedin", "apify"]);

export async function POST(request: Request, { params }: { params: Promise<{ source: string }> }) {
  const { source } = await params;
  if (!SOURCES.has(source)) return NextResponse.json({ ok: false }, { status: 404 });
  const secret = process.env.WEBHOOK_SECRET || "";
  const donne = request.headers.get("x-cle") || new URL(request.url).searchParams.get("cle") || "";
  if (!secret || !safeEqual(donne, secret)) return NextResponse.json({ ok: false }, { status: 401 });

  const texte = await request.text();
  let charge: unknown;
  try {
    charge = JSON.parse(texte);
  } catch {
    charge = { texte };
  }
  await requete(`insert into evenements_bruts (source, charge, origine) values ($1, $2::jsonb, 'C')`, [source, JSON.stringify(charge)]);
  return NextResponse.json({ ok: true });
}
