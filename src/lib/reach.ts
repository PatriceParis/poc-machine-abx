// ReachMCP : lecture du profil LinkedIn de Yannig, relié le 28/10/2026 (accord écrit du 24/10). API REST, clé REACH_API.
// Formats lus sur de vraies réponses le 28/10/2026. Deux lectures alimentent le score :
//   posts     les 20 derniers posts de chaque auteur suivi ; un post n'est relu que si ses compteurs ont bougé, et seule
//             une réaction (engagement_post) ou un commentaire (commentaire_post) d'une personne d'un compte de la base compte
//   messages  un message reçu d'une personne d'un compte de la base (reponse_linkedin), annoncé par webhook
// Les visiteurs du profil exigent LinkedIn Premium : sans abonnement, la liste revient vide.
import { requete } from "@/lib/db";
import { compteDe, creerContact, ecrireSignaux, estDecideur, fonctionDuPoste, referentiel, urlNormale, type Compte, type Referentiel, type Signal } from "@/lib/releves";

type PostReach = { post_urn: string; post_url: string; published_at_relative?: string; total_likes: number; total_comments: number };
type Engageur = { type: "like" | "comment"; linkedin_id: string; linkedin_public_id?: string; firstname?: string; lastname?: string; headline?: string };
type Fiche = { company?: string; company_id?: string; company_linkedin?: string };
type Personne = { linkedin_id: string; public_id?: string | null; prenom?: string | null; nom?: string | null; titre?: string | null };
type Employeur = { entreprise: string | null; entreprise_id: string | null; entreprise_url: string | null };

async function appel<T>(chemin: string): Promise<T> {
  const cle = process.env.REACH_API;
  if (!cle) throw new Error("REACH_API absente");
  const r = await fetch(`https://app.reachmcp.com/api${chemin}`, { headers: { "X-API-Key": cle, "User-Agent": "Mozilla/5.0 (machine Hirondo)" } });
  if (!r.ok) throw new Error(`ReachMCP ${r.status} ${chemin.split("?")[0]}`);
  return r.json() as Promise<T>;
}

const UNITES: Record<string, number> = { minute: 6e4, hour: 36e5, day: 864e5, week: 6048e5, month: 2592e6, year: 31536e6 };
/** « 16 hours ago », « 3 weeks ago » : la date exacte n'est pas donnée. */
function dateRelative(t?: string): Date {
  const m = /(\d+)\s*(minute|hour|day|week|month|year)/i.exec(t || "");
  return new Date(Date.now() - (m ? Number(m[1]) * UNITES[m[2].toLowerCase()] : 0));
}

// « Head of Marketing @ Qonto », « Directrice marketing chez Alan », « Now: Trustly - Global Head of Marketing ».
const MARQUEUR = /(?:@|\bchez\b|\bat\b|\bnow\s*:)\s*([^|·•,;\-–—(]+)/gi;
const entreprisesDuTitre = (titre?: string | null) => [...(titre || "").matchAll(MARQUEUR)].map((m) => m[1].trim()).filter((n) => n.length >= 2);
// Les fiches lues sont comptées (quota du compte relié) : seulement les gens du marketing qui ne se disent pas indépendants.
const INDEPENDANT = /freelance|ind[ée]pendant|fractional|part[- ]?time|temps partag|embarqu|consultant|consulting|advisor|coach|formateur|trainer|mentor/i;
const ficheUtile = (titre?: string | null) => !INDEPENDANT.test(titre || "") && (estDecideur(titre) || ["marketing", "growth"].includes(fonctionDuPoste(titre)));

/** Rapproche une personne d'un compte : contact déjà connu, employeur déjà lu, entreprise citée dans l'intitulé, puis
 *  lecture de sa fiche LinkedIn si le quota du jour le permet. */
async function rapprocher(p: Personne, ref: Referentiel, employeurs: Map<string, Employeur>, quota: { reste: number }, compteReach: number):
  Promise<{ compte: Compte; contactId: number | null } | null> {
  const url = p.public_id ? `https://www.linkedin.com/in/${p.public_id}` : null;
  const connu = ref.contactParId.get(p.linkedin_id) ?? (url ? ref.contactParUrl.get(urlNormale(url)!) : undefined);
  if (connu?.compte_id) {
    const compte = ref.comptes.find((c) => c.id === connu.compte_id);
    return compte ? { compte, contactId: connu.id } : null;
  }
  let employeur = employeurs.get(p.linkedin_id);
  if (!employeur) {
    for (const n of entreprisesDuTitre(p.titre)) {
      const compte = compteDe({ companyName: n }, ref);
      if (compte) return { compte, contactId: null };
    }
    if (!ficheUtile(p.titre) || quota.reste <= 0) return null;
    quota.reste--;
    const f = await appel<Fiche>(`/linkedin/${compteReach}/scrape-profile?linkedin_id_or_url=${encodeURIComponent(p.linkedin_id)}`);
    employeur = { entreprise: f.company ?? null, entreprise_id: f.company_id ?? null, entreprise_url: f.company_linkedin ?? null };
    await requete(
      `insert into reach_personnes (linkedin_id, entreprise, entreprise_id, entreprise_url) values ($1, $2, $3, $4)
       on conflict (linkedin_id) do update set entreprise = excluded.entreprise, entreprise_id = excluded.entreprise_id,
         entreprise_url = excluded.entreprise_url, lu_le = now()`,
      [p.linkedin_id, employeur.entreprise, employeur.entreprise_id, employeur.entreprise_url]);
    employeurs.set(p.linkedin_id, employeur);
  }
  const compte = compteDe({ companyName: employeur.entreprise ?? undefined, companyId: employeur.entreprise_id ?? undefined,
    companyLinkedinUrl: employeur.entreprise_url ?? undefined }, ref);
  return compte ? { compte, contactId: null } : null;
}

async function contexte() {
  const params = new Map((await requete<{ cle: string; valeur: unknown }>(
    `select cle, valeur from parametres where cle like 'reach\\_%'`)).map((l) => [l.cle, l.valeur]));
  const compteReach = Number(params.get("reach_compte"));
  const [lues] = await requete<{ n: number }>(`select count(*)::int as n from reach_personnes where lu_le >= date_trunc('day', now())`);
  const quota = { reste: Number(params.get("reach_fiches_par_jour") ?? 25) - (lues?.n ?? 0) };
  const employeurs = new Map((await requete<Employeur & { linkedin_id: string }>(
    `select linkedin_id, entreprise, entreprise_id, entreprise_url from reach_personnes`)).map((e) => [e.linkedin_id, e]));
  return { compteReach, auteurs: (params.get("reach_auteurs") as string[] | undefined) ?? [], quota, employeurs, ref: await referentiel() };
}

async function signalPour(p: Personne, type: string, le: string, ref_: string, detail: Record<string, unknown>,
  ctx: Awaited<ReturnType<typeof contexte>>): Promise<Signal | null> {
  const r = await rapprocher(p, ctx.ref, ctx.employeurs, ctx.quota, ctx.compteReach);
  if (!r || r.compte.exclu) return null;
  const url = p.public_id ? `https://www.linkedin.com/in/${p.public_id}` : undefined;
  const contactId = r.contactId ?? await creerContact(r.compte.id,
    { url, linkedin_id: p.linkedin_id, prenom: p.prenom ?? undefined, nom: p.nom ?? undefined, poste: p.titre ?? undefined }, "C", ctx.ref);
  return { type, compte_id: r.compte.id, contact_id: contactId, le, ref: ref_, detail: { ...detail, poste: p.titre ?? null }, origine: "C" };
}

/** Relecture quotidienne des posts des auteurs suivis, puis rapprochement de tous les engageurs des 60 derniers jours
 *  (ceux qui attendaient une lecture de fiche passent dès que le quota le permet). */
export async function relireReach(budgetMs = 120000) {
  const debut = Date.now();
  const ctx = await contexte();
  const bilan = { posts: 0, relus: 0, engagements: 0, fiches: 0, nouveaux: 0 };
  const quotaInitial = ctx.quota.reste;
  for (const auteur of ctx.auteurs) {
    const { posts } = await appel<{ posts: PostReach[] }>(`/linkedin/${ctx.compteReach}/user-posts?linkedin_id_or_url=${encodeURIComponent(auteur)}&count=20`);
    const deja = new Map((await requete<{ urn: string; reactions: number; commentaires: number }>(
      `select urn, reactions, commentaires from reach_posts where urn = any($1::text[])`, [posts.map((p) => p.post_urn)])).map((l) => [l.urn, l]));
    for (const p of posts) {
      const publie = dateRelative(p.published_at_relative);
      if (Date.now() - publie.getTime() > 60 * 864e5) continue;
      bilan.posts++;
      const d = deja.get(p.post_urn);
      if (d && d.reactions === p.total_likes && d.commentaires === p.total_comments) continue;
      if (Date.now() - debut > budgetMs / 2) break;
      // L'adresse complète du post est exigée : l'URN seule rend une liste vide.
      const { items } = await appel<{ items: Engageur[] }>(
        `/linkedin/${ctx.compteReach}/scrape-post?post_id_or_url=${encodeURIComponent(p.post_url)}&liked=true&comments=true`);
      await requete(
        `insert into reach_posts (urn, url, reactions, commentaires, publie_le, premier_lu_le, lu_le) values ($1, $2, $3, $4, $5, now(), now())
         on conflict (urn) do update set url = excluded.url, reactions = excluded.reactions, commentaires = excluded.commentaires, lu_le = now()`,
        [p.post_urn, p.post_url.split("?")[0], p.total_likes, p.total_comments, publie.toISOString()]);
      const autres = (items ?? []).filter((e) => e.linkedin_id && !ctx.auteurs.includes(e.linkedin_public_id ?? ""));
      const r = await requete(
        `insert into reach_engagements (post_urn, linkedin_id, nature, public_id, prenom, nom, titre)
         select $1, v.i, v.n, v.p, v.pr, v.no, v.t
         from unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[]) as v(i, n, p, pr, no, t)
         on conflict do nothing returning 1`,
        [p.post_urn, autres.map((e) => e.linkedin_id), autres.map((e) => e.type), autres.map((e) => e.linkedin_public_id ?? null),
         autres.map((e) => e.firstname ?? null), autres.map((e) => e.lastname ?? null), autres.map((e) => e.headline ?? null)]);
      bilan.relus++;
      bilan.engagements += r.length;
    }
  }

  // Une réaction vue à la première lecture d'un post ancien est datée deux jours après lui, au plus tard le jour de la lecture.
  const lignes = await requete<Personne & { post_urn: string; url: string; nature: "like" | "comment"; le: string }>(
    `select e.post_urn, p.url, e.linkedin_id, e.nature, e.public_id, e.prenom, e.nom, e.titre,
            case when e.vu_le <= p.premier_lu_le + interval '1 hour' then least(p.publie_le + interval '2 days', e.vu_le) else e.vu_le end as le
     from reach_engagements e join reach_posts p on p.urn = e.post_urn
     where e.vu_le >= now() - interval '60 days' order by e.vu_le`);
  const signaux: Signal[] = [];
  for (const l of lignes) {
    if (Date.now() - debut > budgetMs) break;
    const type = l.nature === "comment" ? "commentaire_post" : "engagement_post";
    const s = await signalPour(l, type, new Date(l.le).toISOString(), `reach:${l.nature}:${l.post_urn}:${l.linkedin_id}`,
      { post: l.url, nature: l.nature === "comment" ? "commentaires" : "reactions" }, ctx).catch(() => null);
    if (s) signaux.push(s);
  }
  bilan.fiches = quotaInitial - ctx.quota.reste;
  bilan.nouveaux = await ecrireSignaux(signaux, "reachmcp");
  await requete(`insert into releves (nature, statut, termine_le, elements, nouveaux_signaux, detail) values ('reach', 'terminé', now(), $1, $2, $3::jsonb)`,
    [bilan.engagements, bilan.nouveaux, JSON.stringify(bilan)]);
  return bilan;
}

/** Webhook message.received : un message d'une personne d'un compte de la base, hors conversation de groupe. */
export async function interpreterMessage(data: Record<string, unknown>): Promise<number> {
  const part = data.participant as { firstname?: string; lastname?: string; headline?: string; linkedin_id?: string } | undefined;
  if (data.is_groupchat || !part?.linkedin_id) return 0;
  const ctx = await contexte();
  const s = await signalPour({ linkedin_id: part.linkedin_id, prenom: part.firstname, nom: part.lastname, titre: part.headline },
    "reponse_linkedin", String(data.last_activity_at ?? new Date().toISOString()), `reach:message:${String(data.conversation_id)}`, {}, ctx);
  return s ? ecrireSignaux([s], "reachmcp") : 0;
}
