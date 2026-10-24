import { NextResponse } from "next/server";
import { requete } from "@/lib/db";
import { PAGES_CLES, empreinteIp, rapprocher, reseauDeIp, type CompteCandidat } from "@/lib/visites";

// Réception d'une visite du site suivi, envoyée par /t.js. Aucun cookie. L'adresse IP sert à trouver
// le réseau d'origine puis n'est conservée que sous forme d'empreinte. Origine C : donnée de campagne.

const sites = () => (process.env.SITES_SUIVIS || "hirondo.co,www.hirondo.co").split(",").map((s) => s.trim()).filter(Boolean);

function entetesCors(origine: string | null) {
  const autorise = origine && sites().some((s) => origine === `https://${s}` || origine === `http://${s}`);
  return {
    "access-control-allow-origin": autorise ? origine! : `https://${sites()[0]}`,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    vary: "origin",
  };
}

export async function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: entetesCors(request.headers.get("origin")) });
}

let cache: { comptes: CompteCandidat[]; le: number } | null = null;
async function comptes(): Promise<CompteCandidat[]> {
  if (cache && Date.now() - cache.le < 10 * 60 * 1000) return cache.comptes;
  const lignes = await requete<CompteCandidat>("select id::int as id, nom, domaine, effectif from comptes where not exclu");
  cache = { comptes: lignes, le: Date.now() };
  return lignes;
}

export async function POST(request: Request) {
  const cors = entetesCors(request.headers.get("origin"));
  const agent = request.headers.get("user-agent") || "";
  if (/bot|crawl|spider|preview|headless|monitor/i.test(agent)) return new NextResponse(null, { status: 204, headers: cors });

  let corps: { page?: string; ref?: string } = {};
  try {
    corps = JSON.parse(await request.text());
  } catch {}
  let page = "";
  try {
    const u = new URL(String(corps.page || ""));
    if (!sites().includes(u.hostname)) return new NextResponse(null, { status: 204, headers: cors });
    page = `${u.hostname}${u.pathname}`;
  } catch {
    return new NextResponse(null, { status: 204, headers: cors });
  }

  const ip = (request.headers.get("x-real-ip") || request.headers.get("x-forwarded-for") || "").split(",")[0].trim();
  if (!ip) return new NextResponse(null, { status: 204, headers: cors });
  const reseau = await reseauDeIp(ip);
  const lien = reseau ? rapprocher(reseau, await comptes()) : null;
  const visiteur = await empreinteIp(ip);
  const maintenant = new Date().toISOString();
  const jour = maintenant.slice(0, 10);

  await requete(
    `insert into evenements_bruts (source, charge, origine, traite) values ('site', $1::jsonb, 'C', true)`,
    [JSON.stringify({ page, referent: corps.ref || null, visiteur, reseau, compte_id: lien?.compte.id ?? null, rapprochement: lien?.par ?? null })],
  );

  if (lien) {
    const id = lien.compte.id;
    const detail = JSON.stringify({ page, reseau: reseau?.nom, par: lien.par });
    await requete(
      `insert into signaux (type_code, compte_id, survenu_le, source, ref_externe, detail, origine)
       values ('visite_site', $1, $2, 'site', $3, $4::jsonb, 'C') on conflict (source, ref_externe) do nothing`,
      [id, maintenant, `site:${id}:${jour}`, detail],
    );
    if (PAGES_CLES.test(page)) {
      await requete(
        `insert into signaux (type_code, compte_id, survenu_le, source, ref_externe, detail, origine)
         values ('visite_page_cle', $1, $2, 'site', $3, $4::jsonb, 'C') on conflict (source, ref_externe) do nothing`,
        [id, maintenant, `site:${id}:cle:${jour}`, detail],
      );
    }
    const jours = await requete<{ n: number }>(
      `select count(distinct date_trunc('day', survenu_le))::int as n from signaux
       where compte_id = $1 and type_code = 'visite_site' and survenu_le >= now() - interval '30 days'`,
      [id],
    );
    if ((jours[0]?.n ?? 0) >= 3) {
      await requete(
        `insert into signaux (type_code, compte_id, survenu_le, source, ref_externe, detail, origine)
         values ('visites_repetees', $1, $2, 'site', $3, '{}'::jsonb, 'C') on conflict (source, ref_externe) do nothing`,
        [id, maintenant, `site:${id}:repetees:${jour.slice(0, 7)}`],
      );
    }
  }
  return new NextResponse(null, { status: 204, headers: cors });
}
