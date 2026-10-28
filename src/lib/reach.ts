// ReachMCP : lecture du profil LinkedIn de Yannig, relié le 28/10/2026 (accord écrit du 24/10). API REST, clé REACH_API.
// Formats lus sur de vraies réponses le 28/10/2026. Deux lectures alimentent le score :
//   posts     les 20 derniers posts de chaque auteur suivi ; un post n'est relu que si ses compteurs ont bougé, et seule
//             une réaction (engagement_post) ou un commentaire (commentaire_post) d'une personne d'un compte de la base compte
//   messages  un message reçu d'une personne d'un compte de la base (reponse_linkedin), annoncé par webhook
// Les visiteurs du profil exigent LinkedIn Premium : sans abonnement, la liste revient vide.
import { requete } from "@/lib/db";
import { compteDe, creerContact, ecrireSignaux, estDecideur, fonctionDuPoste, personneExclue, referentiel, urlNormale, type Compte, type Referentiel, type Signal } from "@/lib/releves";

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
  if (personneExclue(ctx.ref, { public_id: p.public_id, linkedin_id: p.linkedin_id, titre: p.titre })) return null;
  const r = await rapprocher(p, ctx.ref, ctx.employeurs, ctx.quota, ctx.compteReach);
  if (!r || r.compte.exclu) return null;
  const url = p.public_id ? `https://www.linkedin.com/in/${p.public_id}` : undefined;
  const contactId = r.contactId ?? await creerContact(r.compte.id,
    { url, linkedin_id: p.linkedin_id, prenom: p.prenom ?? undefined, nom: p.nom ?? undefined, poste: p.titre ?? undefined }, "C", ctx.ref);
  return { type, compte_id: r.compte.id, contact_id: contactId, le, ref: ref_, detail: { ...detail, poste: p.titre ?? null }, origine: "C" };
}

// Retire les signaux d'intention déjà portés par une personne devenue exclue (même requête que la configuration).
export const RETIRER_SIGNAUX_EXCLUS = `delete from signaux s using contacts ct
  where s.contact_id = ct.id
    and s.type_code in ('engagement_post', 'commentaire_post', 'engagement_pairs', 'reponse_linkedin', 'visite_profil')
    and (lower(substring(ct.url_linkedin from '/in/([^/?#]+)')) in (select cle from personnes_exclues)
         or ct.linkedin_id in (select cle from personnes_exclues))`;

type Membre = { linkedin_id?: string; linkedin_public_id?: string; public_id?: string; profile_url?: string; firstname?: string; lastname?: string; full_name?: string };
/** Une fois par semaine : les personnes dont le poste actuel est chez le client (recherche LinkedIn par page entreprise,
 *  10 résultats par page) rejoignent les personnes exclues. Lancée avant les fiches, elle passe en premier sur le quota. */
async function relireMembres(ctx: Awaited<ReturnType<typeof contexte>>) {
  const [p] = await requete<{ valeur: string | null }>(`select valeur #>> '{}' as valeur from parametres where cle = 'client_linkedin_id'`);
  const [d] = await requete<{ le: string | null }>(`select max(lance_le) as le from releves where nature = 'membres' and statut = 'terminé'`);
  if (!p?.valeur || (d?.le && Date.now() - new Date(d.le).getTime() < 6.5 * 864e5)) return null;
  const recherche = `https://www.linkedin.com/search/results/people/?currentCompany=%5B%22${p.valeur}%22%5D&origin=FACETED_SEARCH`;
  const membres: Membre[] = [];
  try {
    for (let start = 0; start < 80; start += 10) {
      const r = await appel<{ items?: Membre[]; results?: Membre[]; profiles?: Membre[] }>(
        `/linkedin/${ctx.compteReach}/scrape-search?url=${encodeURIComponent(recherche)}&start=${start}`);
      const page = r.items ?? r.results ?? r.profiles ?? [];
      membres.push(...page);
      if (page.length < 10) break;
    }
  } catch (e) {
    await requete(`insert into releves (nature, statut, termine_le, erreur) values ('membres', 'échec', now(), $1)`, [String((e as Error).message).slice(0, 200)]);
    return { erreur: String((e as Error).message).slice(0, 200) };
  }
  const lignes: { cle: string; nom: string }[] = [];
  for (const m of membres) {
    const nom = (m.full_name ?? `${m.firstname ?? ""} ${m.lastname ?? ""}`).trim();
    const pub = (m.linkedin_public_id ?? m.public_id ?? (m.profile_url || "").toLowerCase().match(/\/in\/([^/?#]+)/)?.[1] ?? "").toLowerCase();
    if (pub) lignes.push({ cle: pub, nom });
    if (m.linkedin_id) lignes.push({ cle: m.linkedin_id, nom });
  }
  const r = await requete(
    `insert into personnes_exclues (cle, nom, motif, source)
     select v.c, v.n, 'poste actuel chez le client (LinkedIn)', 'linkedin' from unnest($1::text[], $2::text[]) as v(c, n)
     on conflict (cle) do nothing returning 1`, [lignes.map((l) => l.cle), lignes.map((l) => l.nom)]);
  for (const l of lignes) ctx.ref.personnesExclues.add(l.cle);
  const retires = await requete(`${RETIRER_SIGNAUX_EXCLUS} returning 1`);
  await requete(`insert into releves (nature, statut, termine_le, elements, detail) values ('membres', 'terminé', now(), $1, $2::jsonb)`,
    [membres.length, JSON.stringify({ nouveaux_exclus: r.length, signaux_retires: retires.length })]);
  return { membres: membres.length, nouveaux_exclus: r.length, signaux_retires: retires.length };
}

/** Relecture quotidienne des posts des auteurs suivis, puis rapprochement de tous les engageurs des 60 derniers jours
 *  (ceux qui attendaient une lecture de fiche passent dès que le quota le permet). */
export async function relireReach(budgetMs = 120000) {
  const debut = Date.now();
  const ctx = await contexte();
  const membres = await relireMembres(ctx);
  const bilan = { posts: 0, relus: 0, engagements: 0, fiches: 0, nouveaux: 0, membres };
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
