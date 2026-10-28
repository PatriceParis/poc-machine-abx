import { NextResponse } from "next/server";
import { adressePublique } from "@/lib/adresse";
import { requete } from "@/lib/db";
import { safeEqual } from "@/lib/auth";
import { ACTEURS, lancer } from "@/lib/apify";
import { verifierEnAttente } from "@/lib/zerobounce";
import { secondPassageEnAttente } from "@/lib/pipecorn";
import { relireReach } from "@/lib/reach";

// Deux déclenchements :
//   ?forcer=hebdo  la mise à jour hebdomadaire, le lundi à 5 h heure de Paris (GitHub Actions, rafraichissement-hebdo.yml) :
//                  prises de poste, offres d'emploi, engageurs des posts suivis, relecture des décideurs si un mois
//                  s'est écoulé, vérification des emails et second passage d'enrichissement
//   sans forcer    la tâche quotidienne de Vercel : vérification des emails, second passage, posts de Yannig relus par
//                  ReachMCP, et engageurs Apify des seuls posts en période de relecture quotidienne (date « jusqu_au »)
// Les résultats reviennent par /api/webhook/apify. ?forcer=postes|decideurs|offres|engageurs|manquants|verifications|reach
// lance un relevé à la demande. Chaque passage est noté dans releves (nature « tache »).
export const maxDuration = 300;

const PLAFONDS = { postes: 0.5, decideurs: 2.5, engageurs: 1, manquants: 1.5, offres: 0.6 };

async function dernier(nature: string): Promise<Date | null> {
  const [l] = await requete<{ le: string | null }>(`select max(lance_le) as le from releves where nature = $1 and statut <> 'échec'`, [nature]);
  return l?.le ? new Date(l.le) : null;
}
const depuis = (d: Date | null) => (d ? (Date.now() - d.getTime()) / 86400000 : Infinity);

export async function GET(request: Request) {
  const debut = Date.now();
  const secret = process.env.CRON_SECRET || "";
  const donne = (request.headers.get("authorization") || "").replace(/^Bearer /, "");
  if (!secret || !safeEqual(donne, secret)) return NextResponse.json({ ok: false }, { status: 401 });

  const forcer = new URL(request.url).searchParams.get("forcer");
  const hebdo = forcer === "hebdo";
  // Vérification ZeroBounce des emails restés en attente, puis second passage Pipecorn sur les introuvables et les
  // refusés (crédits épuisés la veille ou le mois précédent).
  const enrichissement = !forcer || hebdo || forcer === "verifications";
  const verification = enrichissement ? await verifierEnAttente().catch(() => null) : null;
  const cascade = enrichissement ? await secondPassageEnAttente(150000).catch(() => null) : null;
  if (forcer === "verifications") return NextResponse.json({ ok: true, verification, cascade });

  // ReachMCP, chaque jour : posts de Yannig dont les compteurs ont bougé, puis rapprochement des engageurs (gratuit,
  // hors interrupteur des relevés Apify). Lancé en dernier, dans le temps qui reste avant la limite de 300 s : une
  // lecture interrompue reprend le lendemain. Une panne de ReachMCP ne bloque pas le reste de la tâche.
  const lireReach = async (plafond: number) => (!forcer || hebdo || forcer === "reach") && Date.now() - debut < 230000
    ? relireReach(Math.min(plafond, 260000 - (Date.now() - debut))).catch((e: Error) => ({ erreur: String(e.message).slice(0, 200) }))
    : null;
  if (forcer === "reach") return NextResponse.json({ ok: true, reach: await lireReach(240000) });

  const params = new Map((await requete<{ cle: string; valeur: unknown }>(`select cle, valeur from parametres`)).map((p) => [p.cle, p.valeur]));
  const tache = (lances: string[], reach: unknown) => requete(`insert into releves (nature, statut, termine_le, detail) values ('tache', 'terminé', now(), $1::jsonb)`,
    [JSON.stringify({ hebdo, lances, verification, cascade, reach })]);
  if (params.get("releves_actifs") !== true) {
    const reach = await lireReach(100000);
    await tache([], reach);
    return NextResponse.json({ ok: true, lance: [], verification, cascade, reach, raison: "relevés coupés" });
  }

  const retour = (nature: string) => `${adressePublique(request)}/api/webhook/apify?cle=${encodeURIComponent(process.env.WEBHOOK_SECRET || "")}&nature=${nature}`;
  const lances: string[] = [];
  const noter = (nature: string, runId: string, detail: unknown) =>
    requete(`insert into releves (nature, run_id, detail) values ($1, $2, $3::jsonb)`, [nature, runId, JSON.stringify(detail)]);

  if (forcer === "postes" || hebdo) {
    const entree = {
      profileScraperMode: "Short", recentlyChangedJobs: true, locations: ["France"], maxItems: 100, takePages: 4,
      currentJobTitles: params.get("surveillance_titres"), industryIds: params.get("surveillance_secteurs"), companyHeadcount: params.get("surveillance_effectifs"),
    };
    await noter("postes", await lancer(ACTEURS.postes, entree, retour("postes"), PLAFONDS.postes), { entree });
    lances.push("postes");
  }

  if (forcer === "decideurs" || (hebdo && depuis(await dernier("decideurs")) >= 27)) {
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

  // Chaque semaine : offres d'emploi LinkedIn en marketing ops, CRM, ABM publiées en France depuis 7 jours.
  // Préféré à ReachMCP : l'offre porte l'adresse de la page de l'entreprise, la clé du TAM, là où ReachMCP rend un identifiant numérique.
  if (forcer === "offres" || hebdo) {
    const entree = { keywords: params.get("offres_mots_cles"), location: "France", datePosted: "pastWeek", scrapeCompany: false, limitPerSource: 500 };
    await noter("offres", await lancer(ACTEURS.offres, entree, retour("offres"), PLAFONDS.offres), { entree });
    lances.push("offres");
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

  if (forcer === "engageurs" || hebdo || !forcer) {
    // Un post se relit chaque jour jusqu'à sa date « jusqu_au » (période où il prend ses réactions), sinon chaque lundi.
    // Chaque lecture repaie tous les engageurs : la fréquence décide du coût.
    const posts = (params.get("posts_suivis") as { url: string; nature: string; jusqu_au?: string }[] | undefined) ?? [];
    for (const post of posts) {
      const [l] = await requete<{ le: string | null }>(
        `select max(lance_le) as le from releves where nature = 'engageurs' and detail->'post'->>'url' = $1 and statut <> 'échec'`, [post.url]);
      const quotidien = post.jusqu_au ? new Date(post.jusqu_au).getTime() >= Date.now() : false;
      const ecart = depuis(l?.le ? new Date(l.le) : null);
      if (!forcer && (!quotidien || ecart < 0.9)) continue;
      for (const nature of ["reactions", "commentaires"] as const) {
        const entree = { posts: [post.url], maxItems: 300, profileScraperMode: "main", ...(nature === "commentaires" ? { scrapeReplies: true } : {}) };
        const runId = await lancer(ACTEURS[nature], entree, `${retour("engageurs")}&type=${nature}`, PLAFONDS.engageurs);
        await noter("engageurs", runId, { post, type: nature });
        lances.push(`${nature} ${post.url}`);
      }
    }
  }
  const reach = await lireReach(100000);
  await tache(lances, reach);
  return NextResponse.json({ ok: true, lances, verification, cascade, reach });
}
