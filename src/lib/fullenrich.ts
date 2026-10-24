// FullEnrich (API v2) : lancement d'une recherche d'email ou de téléphone, écriture des résultats.
// Les résultats arrivent par webhook (signé HMAC-SHA1 avec la clé) et, en secours, par lecture à la demande.
// Une recherche prend 30 à 90 secondes par contact (cascade d'une vingtaine de fournisseurs).
import { requete } from "@/lib/db";

const API = "https://app.fullenrich.com/api/v2/contact/enrich/bulk";
export const CHAMPS = { email: "contact.work_emails", telephone: "contact.phones" } as const;
export type Champ = keyof typeof CHAMPS;

export function cle() {
  const k = process.env.FULLENRICH_API;
  if (!k) throw new Error("FULLENRICH_API absente");
  return k;
}

// Les cinq champs partent à chaque fois (consigne de Patrice) : prénom, nom, domaine, entreprise, profil LinkedIn.
// Le domaine est celui des adresses email quand on le connaît (BNP Paribas : site group.bnpparibas, emails en
// @bnpparibas.com), sinon celui du site.
function domaine(email: string | null, site: string | null) {
  return email || site || null;
}

type ContactAEnrichir = { id: number; prenom: string | null; nom: string | null; url_linkedin: string | null; compte: string | null; domaine: string | null; domaine_email: string | null };

export async function contactsAEnrichir(where: string, params: unknown[]) {
  return requete<ContactAEnrichir>(
    `select ct.id::int, ct.prenom, ct.nom, ct.url_linkedin, co.nom as compte, co.domaine, co.domaine_email
     from contacts ct left join comptes co on co.id = ct.compte_id
     where ct.origine = 'A' and ${where} limit 100`, params);
}

export async function lancer(contacts: ContactAEnrichir[], champ: Champ, nom: string, retour: string): Promise<string> {
  const data = contacts.map((c) => {
    const d: Record<string, unknown> = { enrich_fields: [CHAMPS[champ]], custom: { contact_id: String(c.id), champ } };
    if (c.url_linkedin?.includes("linkedin.com/in/")) d.linkedin_url = c.url_linkedin;
    if (c.prenom && c.nom) Object.assign(d, { first_name: c.prenom, last_name: c.nom });
    const dom = domaine(c.domaine_email, c.domaine);
    if (dom) d.domain = dom;
    if (c.compte) d.company_name = c.compte;
    return d;
  });
  const r = await fetch(API, {
    method: "POST",
    headers: { authorization: `Bearer ${cle()}`, "content-type": "application/json" },
    body: JSON.stringify({ name: nom, webhook_url: retour, data }),
  });
  const d = (await r.json().catch(() => ({}))) as { enrichment_id?: string; message?: string };
  if (!r.ok || !d.enrichment_id) throw new Error(d.message ?? `FullEnrich ${r.status}`);
  return d.enrichment_id;
}

/** Cherche l'email de chaque contact visé par une alerte « nouveau décideur » active qui n'en a pas et n'a jamais été
 *  cherché. Appelé après chaque relevé des prises de poste, sans clic. enrichi_le est posé au lancement pour qu'un
 *  second relevé ne relance pas la même recherche. Réservoir A seulement. Renvoie le nombre de recherches lancées. */
export async function enrichirAlertes(retour: string): Promise<number> {
  const contacts = await contactsAEnrichir(
    // Table signaux et non la vue signaux_actifs : la vue ne garde qu'un déclencheur par type et par compte,
    // or un compte peut avoir deux nouveaux décideurs.
    `ct.email is null and ct.enrichi_le is null and not co.exclu and ct.id in (
       select s.contact_id from signaux s join types_signal t on t.code = s.type_code
       where s.type_code = 'nouveau_decideur_marketing' and s.contact_id is not null
         and (t.expire_jours is null or s.survenu_le >= now() - make_interval(days => t.expire_jours)))`, []);
  if (!contacts.length) return 0;
  await requete(`update contacts set enrichi_le = now() where id = any($1::bigint[])`, [contacts.map((c) => c.id)]);
  await lancer(contacts, "email", `Alertes nouveau décideur · ${contacts.length} emails`, retour);
  return contacts.length;
}

export type Resultat = {
  id?: string;
  status?: string;
  code?: string;
  data?: { custom?: { contact_id?: string; champ?: string }; contact_info?: {
    most_probable_work_email?: { email?: string; status?: string };
    most_probable_phone?: { number?: string; line_status?: string };
  } }[];
};

export async function lire(id: string): Promise<Resultat> {
  const r = await fetch(`${API}/${id}`, { headers: { authorization: `Bearer ${cle()}` }, cache: "no-store" });
  return (await r.json().catch(() => ({}))) as Resultat;
}

export const termine = (d: Resultat) => d.status === "FINISHED" || d.status === "CANCELED" || d.status === "CREDITS_INSUFFICIENT";

/** Écrit les coordonnées trouvées (valeur la plus probable) et garde la réponse brute. Idempotent. */
export async function ecrire(d: Resultat): Promise<{ contact_id: number; champ: string; valeur: string | null; detail: string | null }[]> {
  await requete(`insert into evenements_bruts (source, charge, origine, traite) values ('fullenrich', $1::jsonb, 'A', true)`, [JSON.stringify(d)]);
  const sortie = [];
  for (const ligne of d.data ?? []) {
    const id = Number(ligne.custom?.contact_id);
    const champ = ligne.custom?.champ === "telephone" ? "telephone" : "email";
    if (!id) continue;
    if (champ === "email") {
      const e = ligne.contact_info?.most_probable_work_email;
      // « introuvable » distingue une recherche sans résultat d'une recherche jamais faite (enrichi_le sert aussi au téléphone).
      await requete(
        `update contacts set email = coalesce($2, email),
                email_statut = case when $2::text is not null then $3 when email is null then 'introuvable' else email_statut end,
                enrichi_le = now() where id = $1`,
        [id, e?.email ?? null, e?.status ?? null]);
      if (e?.email) {
        await requete(`update comptes set domaine_email = coalesce(domaine_email, split_part($2, '@', 2)) where id = (select compte_id from contacts where id = $1)`, [id, e.email]);
      }
      sortie.push({ contact_id: id, champ, valeur: e?.email ?? null, detail: e?.status ?? null });
    } else {
      const t = ligne.contact_info?.most_probable_phone;
      await requete(`update contacts set telephone = coalesce($2, telephone), enrichi_le = now() where id = $1`, [id, t?.number ?? null]);
      sortie.push({ contact_id: id, champ, valeur: t?.number ?? null, detail: t?.line_status ?? null });
    }
  }
  return sortie;
}
