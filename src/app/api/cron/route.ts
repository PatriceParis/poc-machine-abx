import { NextResponse } from "next/server";
import { requete } from "@/lib/db";
import { safeEqual } from "@/lib/auth";
import { ACTEURS, lancer } from "@/lib/apify";

// Tâche quotidienne (Vercel Cron, une fois par jour sur l'offre gratuite). Elle lance ce qui est dû :
//   engageurs  chaque jour, pour chaque post suivi
//   postes     chaque semaine, recherche des décideurs marketing qui ont changé de poste
//   decideurs  chaque mois, relecture des décideurs des comptes A et B
// Les résultats reviennent par /api/webhook/apify. ?forcer=postes|decideurs|engageurs lance à la demande.
export const maxDuration = 60;

const PLAFONDS = { postes: 0.5, decideurs: 2.5, engageurs: 1, manquants: 1.5 };

async function dernier(nature: string): Promise<Date | null> {
  const [l] = await requete<{ le: string | null }>(`select max(lance_le) as le from releves where nature = $1 and statut <> 'échec'`, [nature]);
  return l?.le ? new Date(l.le) : null;
}
const depuis = (d: Date | null) => (d ? (Date.now() - d.getTime()) / 86400000 : Infinity);

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET || "";
  const donne = (request.headers.get("authorization") || "").replace(/^Bearer /, "");
  if (!secret || !safeEqual(donne, secret)) return NextResponse.json({ ok: false }, { status: 401 });

  const params = new Map((await requete<{ cle: string; valeur: unknown }>(`select cle, valeur from parametres`)).map((p) => [p.cle, p.valeur]));
  if (params.get("releves_actifs") !== true) return NextResponse.json({ ok: true, lance: [], raison: "relevés coupés" });

  const forcer = new URL(request.url).searchParams.get("forcer");
  const retour = (nature: string) => `${new URL("/api/webhook/apify", request.url).toString()}?cle=${encodeURIComponent(process.env.WEBHOOK_SECRET || "")}&nature=${nature}`;
  const lances: string[] = [];
  const noter = (nature: string, runId: string, detail: unknown) =>
    requete(`insert into releves (nature, run_id, detail) values ($1, $2, $3::jsonb)`, [nature, runId, JSON.stringify(detail)]);

  if (forcer === "postes" || (!forcer && depuis(await dernier("postes")) >= 6.5)) {
    const entree = {
      profileScraperMode: "Short", recentlyChangedJobs: true, locations: ["France"], maxItems: 100, takePages: 4,
      currentJobTitles: params.get("surveillance_titres"), industryIds: params.get("surveillance_secteurs"), companyHeadcount: params.get("surveillance_effectifs"),
    };
    await noter("postes", await lancer(ACTEURS.postes, entree, retour("postes"), PLAFONDS.postes), { entree });
    lances.push("postes");
  }

  if (forcer === "decideurs" || (!forcer && depuis(await dernier("decideurs")) >= 28)) {
    const urls = (await requete<{ url: string }>(
      `select ct.url_linkedin as url from contacts ct join score_comptes s on s.compte_id = ct.compte_id
       where not s.exclu and s.palier in ('A', 'B') and ct.url_linkedin like 'https://www.linkedin.com/in/%'
         and ct.poste ~* '(cmo|chief marketing|directeur.*marketing|directrice.*marketing|marketing director|director of marketing|head of marketing|vp marketing|directeur.*communication|directrice.*communication|chief brand|chief growth|head of growth)'
       order by ct.id limit 500`)).map((l) => l.url);
    if (urls.length) {
      await noter("decideurs", await lancer(ACTEURS.decideurs, { profileScraperMode: "Profile details no email ($4 per 1k)", urls }, retour("decideurs"), PLAFONDS.decideurs), { profils: urls.length });
      lances.push(`decideurs (${urls.length})`);
    }
  }

  // À la demande seulement : décideurs marketing des comptes A qui n'en ont aucun dans la base.
  if (forcer === "manquants") {
    const companies = (await requete<{ url: string }>(
      `select s.url_linkedin as url from score_comptes s
       where not s.exclu and s.palier = 'A' and s.url_linkedin like 'https://www.linkedin.com/company/%'
         and not exists (select 1 from contacts ct where ct.compte_id = s.compte_id
           and ct.poste ~* '(cmo|chief marketing|directeur.*marketing|directrice.*marketing|marketing director|director of marketing|head of marketing|vp marketing|directeur.*communication|directrice.*communication|chief brand|chief growth|head of growth)')`)).map((l) => l.url);
    // L'acteur refuse plus de 20 entreprises par lancement (« up to 20 companies ») : un lancement par lot de 20.
    for (let i = 0; i < companies.length; i += 20) {
      const lot = companies.slice(i, i + 20);
      const entree = { profileScraperMode: "Short ($4 per 1k)", companies: lot, functionIds: ["15", "16"], seniorityLevelIds: ["220", "300", "310"], companyBatchMode: "all_at_once", maxItems: 100 };
      await noter("manquants", await lancer(ACTEURS.manquants, entree, retour("manquants"), PLAFONDS.manquants), { comptes: lot.length });
      lances.push(`manquants (${lot.length} comptes)`);
    }
  }

  if (forcer === "engageurs" || !forcer) {
    // Un post se relit chaque jour jusqu'à sa date « jusqu_au » (période où il prend ses réactions), sinon chaque semaine.
    // Chaque lecture repaie tous les engageurs : la fréquence décide du coût.
    const posts = (params.get("posts_suivis") as { url: string; nature: string; jusqu_au?: string }[] | undefined) ?? [];
    for (const post of posts) {
      const [l] = await requete<{ le: string | null }>(
        `select max(lance_le) as le from releves where nature = 'engageurs' and detail->'post'->>'url' = $1 and statut <> 'échec'`, [post.url]);
      const quotidien = post.jusqu_au ? new Date(post.jusqu_au).getTime() >= Date.now() : false;
      const ecart = depuis(l?.le ? new Date(l.le) : null);
      if (!forcer && ecart < (quotidien ? 0.9 : 6.5)) continue;
      for (const nature of ["reactions", "commentaires"] as const) {
        const entree = { posts: [post.url], maxItems: 300, profileScraperMode: "main", ...(nature === "commentaires" ? { scrapeReplies: true } : {}) };
        const runId = await lancer(ACTEURS[nature], entree, `${retour("engageurs")}&type=${nature}`, PLAFONDS.engageurs);
        await noter("engageurs", runId, { post, type: nature });
        lances.push(`${nature} ${post.url}`);
      }
    }
  }
  return NextResponse.json({ ok: true, lances });
}
