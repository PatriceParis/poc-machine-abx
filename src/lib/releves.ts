// Interprétation des relevés Apify : changements de poste, relecture des décideurs, engageurs des posts.
// Formats lus sur de vraies sorties le 24/10/2026 (harvestapi). Tout est rapproché en mémoire puis écrit
// en quelques requêtes groupées, pour tenir dans la durée d'une fonction.
import { requete } from "@/lib/db";
import { normaliser } from "@/lib/visites";

type Compte = { id: number; nom: string; url: string | null; linkedin_id: string | null; effectif: number | null; exclu: boolean };
type Contact = { id: number; compte_id: number | null; url: string | null; linkedin_id: string | null; prenom: string | null; nom: string | null; poste: string | null; suivi: Record<string, unknown> | null };
type Position = { title?: string; position?: string; companyName?: string; companyId?: string; companyLinkedinUrl?: string; current?: boolean; startedOn?: { month?: number | string; year?: number }; startDate?: { month?: number | string; year?: number }; company?: { industry?: string } };
type Signal = { type: string; compte_id: number; contact_id: number | null; le: string; ref: string; detail: Record<string, unknown>; origine: "A" | "C" };

const DECIDEUR = /\b(cmo|chief marketing|directeur.*marketing|directrice.*marketing|marketing director|director of marketing|head of marketing|vp marketing|directeur.*communication|directrice.*communication|chief brand|chief growth|head of growth)\b/i;
// « Alternante CMO Support », « assistante de la directrice marketing » : le titre cite le rôle sans l'occuper.
const PAS_DECIDEUR = /alternan|stagi|\bintern\b|apprenti|assistant|support|junior/i;
export const estDecideur = (t?: string | null) => DECIDEUR.test(t || "") && !PAS_DECIDEUR.test(t || "");
// Une entreprise découverte par la surveillance n'entre dans la base que si elle est du secteur visé :
// le filtre de secteur de la recherche porte sur le profil de la personne, pas sur son employeur.
const SECTEURS_VISES = /banking|insurance|financial services|investment management|capital markets|investment banking|venture capital|banque|assurance|services financiers/i;

export function fonctionDuPoste(poste?: string | null): string {
  const p = (poste || "").toLowerCase();
  if (/\b(ceo|dg|pdg)\b|directeur g[ée]n[ée]ral|directrice g[ée]n[ée]rale|pr[ée]sident|fondat|founder|managing director/.test(p)) return "direction_generale";
  if (/growth|acquisition|demand|lead gen|performance marketing/.test(p)) return "growth";
  if (/marketing|communication|brand|marque|digital|crm|contenu|content|[ée]v[ée]nement|event|relations presse|partenariat|cmo/.test(p)) return "marketing";
  return "autre";
}

export const urlNormale = (u?: string | null) => (u ? u.toLowerCase().split("?")[0].replace(/\/+$/, "").replace("://linkedin.com", "://www.linkedin.com") : null);

const MOIS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
export function debutDe(p: Position): Date | null {
  const d = p.startedOn ?? p.startDate;
  if (!d?.year) return null;
  const m = typeof d.month === "number" ? d.month : MOIS[String(d.month || "jan").slice(0, 3).toLowerCase()] ?? 1;
  return new Date(Date.UTC(d.year, m - 1, 1));
}
const recent = (d: Date | null, jours = 183) => Boolean(d && Date.now() - d.getTime() <= jours * 86400000);
const titreDe = (p: Position) => p.title ?? p.position ?? "";

export async function referentiel() {
  // Les comptes exclus restent dans le référentiel : une personne qui y travaille doit être reconnue, puis ignorée,
  // sans quoi son employeur entrerait dans la base comme une nouvelle entreprise.
  const comptes = await requete<Compte>(`select id::int, nom, url_linkedin as url, linkedin_id, effectif, exclu from comptes`);
  const [p] = await requete<{ valeur: string[] | null }>(`select valeur from parametres where cle = 'exclusions_noms'`);
  const exclusions = (p?.valeur ?? []).map((n) => normaliser(n));
  const contacts = await requete<Contact>(`select id::int, compte_id::int, url_linkedin as url, linkedin_id, prenom, nom, poste, suivi from contacts`);
  const parUrl = new Map(comptes.filter((c) => c.url).map((c) => [urlNormale(c.url)!, c]));
  const parId = new Map(comptes.filter((c) => c.linkedin_id).map((c) => [c.linkedin_id!, c]));
  const contactParUrl = new Map(contacts.filter((c) => c.url).map((c) => [urlNormale(c.url)!, c]));
  const contactParId = new Map(contacts.filter((c) => c.linkedin_id).map((c) => [c.linkedin_id!, c]));
  const estExclu = (nom?: string | null) => exclusions.some((e) => e && normaliser(nom || "").includes(e));
  return { comptes, contacts, parUrl, parId, contactParUrl, contactParId, estExclu };
}
type Referentiel = Awaited<ReturnType<typeof referentiel>>;

/** Compte de la base pour une position : adresse de la page, identifiant numérique, puis nom (le plus gros à égalité). */
export function compteDe(p: Position, ref: Referentiel): Compte | null {
  const u = urlNormale(p.companyLinkedinUrl);
  if (u && ref.parUrl.has(u)) return ref.parUrl.get(u)!;
  if (p.companyId && ref.parId.has(String(p.companyId))) return ref.parId.get(String(p.companyId))!;
  const n = normaliser(p.companyName || "");
  if (n.length < 3) return null;
  const candidats = ref.comptes.filter((c) => {
    const nc = normaliser(c.nom);
    return nc === n || (Math.min(nc.length, n.length) >= 6 && (` ${n} `.includes(` ${nc} `) || ` ${nc} `.includes(` ${n} `)));
  });
  candidats.sort((a, b) => (b.effectif ?? 0) - (a.effectif ?? 0));
  return candidats[0] ?? null;
}

function contactParNom(ref: Referentiel, compteId: number, prenom?: string, nom?: string) {
  const cle = normaliser(`${prenom || ""} ${nom || ""}`);
  return ref.contacts.find((c) => c.compte_id === compteId && normaliser(`${c.prenom || ""} ${c.nom || ""}`) === cle) ?? null;
}

async function creerContact(compteId: number, d: { url?: string; linkedin_id?: string; prenom?: string; nom?: string; poste?: string }, origine: "A" | "C", ref: Referentiel): Promise<number> {
  const [l] = await requete<{ id: number }>(
    `insert into contacts (compte_id, url_linkedin, linkedin_id, prenom, nom, poste, fonction, origine)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (url_linkedin) do update set linkedin_id = coalesce(contacts.linkedin_id, excluded.linkedin_id), mis_a_jour_le = now()
     returning id::int`,
    [compteId, d.url ?? null, d.linkedin_id ?? null, d.prenom ?? null, d.nom ?? null, d.poste ?? null, fonctionDuPoste(d.poste), origine]);
  const c: Contact = { id: l.id, compte_id: compteId, url: d.url ?? null, linkedin_id: d.linkedin_id ?? null, prenom: d.prenom ?? null, nom: d.nom ?? null, poste: d.poste ?? null, suivi: null };
  ref.contacts.push(c);
  if (c.url) ref.contactParUrl.set(urlNormale(c.url)!, c);
  if (c.linkedin_id) ref.contactParId.set(c.linkedin_id, c);
  return l.id;
}

export async function ecrireSignaux(signaux: Signal[]): Promise<number> {
  if (!signaux.length) return 0;
  const r = await requete<{ id: number }>(
    `insert into signaux (type_code, compte_id, contact_id, survenu_le, source, ref_externe, detail, origine)
     select v.t, v.c, v.ct, v.le, 'apify', v.r, v.d::jsonb, v.o::origine_donnee
     from unnest($1::text[], $2::bigint[], $3::bigint[], $4::timestamptz[], $5::text[], $6::text[], $7::text[])
          as v(t, c, ct, le, r, d, o)
     on conflict (source, ref_externe) do nothing returning id`,
    [signaux.map((s) => s.type), signaux.map((s) => s.compte_id), signaux.map((s) => s.contact_id), signaux.map((s) => s.le),
     signaux.map((s) => s.ref), signaux.map((s) => JSON.stringify(s.detail)), signaux.map((s) => s.origine)]);
  return r.length;
}

/** Recherche hebdomadaire des décideurs marketing qui ont changé de poste. Un compte absent de la base y entre (réservoir A).
 *  Avec `manquants`, recherche unique des décideurs des comptes qui n'en ont pas : ni date exigée ni compte ajouté. */
export async function interpreterPostes(items: Record<string, unknown>[], ref: Referentiel, manquants = false): Promise<number> {
  const signaux: Signal[] = [];
  for (const it of items) {
    const id = String(it.id ?? "");
    const positions = ((it.currentPositions as Position[]) || []).filter((p) => p.current !== false);
    for (const p of positions) {
      const debut = debutDe(p);
      if (!estDecideur(titreDe(p)) || (!manquants && !recent(debut))) continue;
      let compte = compteDe(p, ref);
      if (compte?.exclu || ref.estExclu(p.companyName)) continue;
      if (!compte && (manquants || !SECTEURS_VISES.test(p.company?.industry || ""))) continue;
      if (!compte) {
        const [c] = await requete<Compte>(
          `insert into comptes (nom, url_linkedin, linkedin_id, activite, pays, b2b, origine)
           values ($1, $2, $3, $4, 'FR', true, 'A')
           on conflict (url_linkedin) do update set linkedin_id = excluded.linkedin_id
           returning id::int, nom, url_linkedin as url, linkedin_id, effectif, exclu`,
          [p.companyName ?? "Entreprise sans nom", p.companyLinkedinUrl ?? `linkedin-id:${p.companyId}`, p.companyId ?? null,
           p.company?.industry ? `${p.company.industry} (prise de poste)` : "Découvert par la surveillance des prises de poste"]);
        compte = c;
        ref.comptes.push(c);
        if (c.url) ref.parUrl.set(urlNormale(c.url)!, c);
        if (c.linkedin_id) ref.parId.set(c.linkedin_id, c);
        // Ce que la recherche garantit : plus de 500 salariés, secteur cœur, un décideur identifié.
        for (const code of ["taille_500", "secteur_coeur", "decideur_identifie"]) {
          signaux.push({ type: code, compte_id: c.id, contact_id: null, le: new Date().toISOString(), ref: `surveillance:${c.id}:${code}`, detail: { par: "surveillance des prises de poste" }, origine: "A" });
        }
      } else if (!compte.linkedin_id && p.companyId) {
        await requete(`update comptes set linkedin_id = $1 where id = $2`, [String(p.companyId), compte.id]);
        compte.linkedin_id = String(p.companyId);
        ref.parId.set(compte.linkedin_id, compte);
      }
      const prenom = it.firstName as string | undefined;
      const nom = it.lastName as string | undefined;
      const existant = ref.contactParId.get(id) ?? contactParNom(ref, compte.id, prenom, nom);
      const contactId = existant?.id ?? await creerContact(compte.id, { url: it.linkedinUrl as string, linkedin_id: id, prenom, nom, poste: titreDe(p) }, "A", ref);
      if (manquants) {
        // Même référence que l'import de la base : le signal d'adéquation n'est jamais compté deux fois.
        signaux.push({ type: "decideur_identifie", compte_id: compte.id, contact_id: null, le: new Date().toISOString(),
          ref: `tam:${compte.url}:decideur_identifie`, detail: { nom: `${prenom ?? ""} ${nom ?? ""}`.trim(), poste: titreDe(p) }, origine: "A" });
        if (!recent(debut)) continue;
      }
      signaux.push({
        type: "nouveau_decideur_marketing", compte_id: compte.id, contact_id: contactId, le: debut!.toISOString(),
        ref: `poste:${id}:${compte.id}:${debut!.toISOString().slice(0, 7)}`,
        detail: { nom: `${prenom ?? ""} ${nom ?? ""}`.trim(), poste: titreDe(p), entreprise: p.companyName }, origine: "A",
      });
    }
  }
  return ecrireSignaux(signaux);
}

/** Relecture mensuelle des décideurs de la base : départ, promotion, arrivée dans un autre compte cible. */
export async function interpreterDecideurs(items: Record<string, unknown>[], ref: Referentiel): Promise<number> {
  const signaux: Signal[] = [];
  const suivis: { id: number; suivi: string; compte: number | null; poste: string | null }[] = [];
  const maintenant = new Date().toISOString();
  for (const it of items) {
    const requeteUrl = (it.originalQuery as { url?: string } | undefined)?.url ?? (it.linkedinUrl as string);
    const contact = ref.contactParUrl.get(urlNormale(requeteUrl)!);
    if (!contact || !contact.compte_id) continue;
    if (ref.comptes.find((c) => c.id === contact.compte_id)?.exclu) continue;
    const positions = (it.currentPosition as Position[]) || [];
    if (!positions.length) continue;
    const ancien = ref.comptes.find((c) => c.id === contact.compte_id);
    const surPlace = positions.find((p) => {
      const c = compteDe(p, ref);
      if (c && c.id === contact.compte_id) return true;
      // Filiale ou nom légal différent : même nom normalisé, ou l'un contient l'autre.
      const a = normaliser(ancien?.nom || ""), b = normaliser(p.companyName || "");
      return a.length >= 4 && b.length >= 4 && (a.includes(b) || b.includes(a));
    });
    const principale = surPlace ?? positions[0];
    const debut = debutDe(principale);
    const mois = maintenant.slice(0, 7);
    // Pharow nomme l'entité juridique, LinkedIn la marque ou une autre page (« Caisse Reg Credit Agricol Mutuel
    // Lorrain » et « Crédit Agricole de Lorraine », « Rci Bank » et « Mobilize ») : un nom différent ne prouve pas
    // un départ. Départ seulement si le poste actuel a commencé depuis moins de six mois et que l'intitulé a changé.
    const memeIntitule = normaliser(titreDe(principale)) === normaliser(contact.poste || "");
    if (surPlace || !recent(debut) || memeIntitule) {
      const poste = surPlace ?? principale;
      const ancienTitre = (contact.suivi?.titre as string) ?? contact.poste ?? null;
      if (surPlace && estDecideur(titreDe(poste)) && recent(debut) && ancienTitre !== titreDe(poste)) {
        signaux.push({ type: "nouveau_decideur_marketing", compte_id: contact.compte_id, contact_id: contact.id, le: debut!.toISOString(),
          ref: `poste:${contact.id}:${contact.compte_id}:${debut!.toISOString().slice(0, 7)}`, detail: { poste: titreDe(poste), entreprise: poste.companyName, nom: `${contact.prenom ?? ""} ${contact.nom ?? ""}`.trim() }, origine: "A" });
      }
      suivis.push({ id: contact.id, suivi: JSON.stringify({ entreprise: poste.companyName, titre: titreDe(poste), debut: debut?.toISOString() ?? null, lu_le: maintenant }), compte: null, poste: null });
    } else {
      // Parti : le poste se libère chez l'ancien compte. Date : début du nouveau poste s'il est connu.
      const le = (debut ?? new Date()).toISOString();
      signaux.push({ type: "depart_decideur_marketing", compte_id: contact.compte_id, contact_id: null, le,
        ref: `depart:${contact.id}:${contact.compte_id}`, detail: { nom: `${contact.prenom ?? ""} ${contact.nom ?? ""}`.trim(), vers: principale.companyName ?? null }, origine: "A" });
      const nouveau = compteDe(principale, ref);
      if (nouveau && !nouveau.exclu && estDecideur(titreDe(principale)) && recent(debut)) {
        signaux.push({ type: "nouveau_decideur_marketing", compte_id: nouveau.id, contact_id: contact.id, le: debut!.toISOString(),
          ref: `poste:${contact.id}:${nouveau.id}:${debut!.toISOString().slice(0, 7)}`, detail: { poste: titreDe(principale), entreprise: principale.companyName, venant_de: ancien?.nom ?? null }, origine: "A" });
      }
      suivis.push({ id: contact.id, suivi: JSON.stringify({ entreprise: principale.companyName, titre: titreDe(principale), debut: debut?.toISOString() ?? null, lu_le: maintenant, parti_de: ancien?.nom ?? null, mois }), compte: nouveau?.id ?? null, poste: titreDe(principale) || null });
    }
  }
  if (suivis.length) {
    await requete(
      `update contacts c set suivi = v.s::jsonb, suivi_le = now(), compte_id = coalesce(v.co, c.compte_id), poste = coalesce(v.p, c.poste), mis_a_jour_le = now()
       from unnest($1::bigint[], $2::text[], $3::bigint[], $4::text[]) as v(id, s, co, p) where c.id = v.id`,
      [suivis.map((s) => s.id), suivis.map((s) => s.suivi), suivis.map((s) => s.compte), suivis.map((s) => s.poste)]);
  }
  return ecrireSignaux(signaux);
}

/** Engageurs d'un post (réactions ou commentaires, mode main) : seul un engageur d'un compte de la base fait un signal. */
export async function interpreterEngageurs(items: Record<string, unknown>[], post: { url: string; nature: string }, nature: "reactions" | "commentaires", ref: Referentiel): Promise<number> {
  const signaux: Signal[] = [];
  for (const it of items) {
    const actor = (it.actor ?? it.author) as Record<string, unknown> | undefined;
    if (!actor) continue;
    const positions = (actor.currentPosition as Position[]) || [];
    const p = positions.find((x) => compteDe(x, ref)) ?? null;
    const compte = p ? compteDe(p, ref) : null;
    if (!compte || !p || compte.exclu) continue;
    const idPersonne = String(actor.id ?? "");
    const url = actor.publicIdentifier ? `https://www.linkedin.com/in/${actor.publicIdentifier}` : (actor.linkedinUrl as string | undefined);
    const existant = ref.contactParId.get(idPersonne) ?? (url ? ref.contactParUrl.get(urlNormale(url)!) : undefined)
      ?? contactParNom(ref, compte.id, actor.firstName as string, actor.lastName as string);
    const contactId = existant?.id ?? await creerContact(compte.id, { url, linkedin_id: idPersonne, prenom: actor.firstName as string, nom: actor.lastName as string, poste: titreDe(p) }, "C", ref);
    const texte = String(it.commentary ?? it.text ?? "");
    const type = nature === "commentaires" && /roadmap/i.test(texte) ? "commentaire_roadmap" : post.nature === "pair" ? "engagement_pairs" : "engagement_post";
    signaux.push({ type, compte_id: compte.id, contact_id: contactId, le: new Date().toISOString(),
      ref: `${nature}:${post.url}:${idPersonne || contactId}`, detail: { post: post.url, nature, poste: titreDe(p) }, origine: "C" });
  }
  return ecrireSignaux(signaux);
}
