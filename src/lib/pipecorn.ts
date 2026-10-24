// Pipecorn : second passage de la cascade d'enrichissement, en synchrone (une requête par contact, de 1 à 30 s).
// Il ne passe que sur deux cas : FullEnrich n'a rien trouvé, ou ZeroBounce refuse l'email connu. 3 crédits par email
// trouvé (offre gratuite : 150 crédits par mois). Sa vérification ne fait pas foi (banc d'essai du 24/10/2026 :
// 3 adresses « deliverable » refusées par ZeroBounce), donc chaque email rendu repasse par ZeroBounce, et une adresse
// déjà refusée est jetée. Réservoir A seulement, comme tout enrichissement tiers.
import { requete } from "@/lib/db";
import { NEGATIFS, valider } from "@/lib/zerobounce";

const API = "https://api.pipecorn.com/v2/contacts/single_enrich";

type Cible = { prenom: string | null; nom: string | null; url_linkedin: string | null; email: string | null; ancien: string | null; compte: string | null; domaine: string | null };
export type Passage = { contact_id: number; valeur: string | null; verif: string | null; arret?: boolean };

/** Contacts qui attendent le second passage : sans email après FullEnrich, ou email refusé. */
export const EN_ATTENTE = `ct.origine = 'A' and ct.second_passage_le is null
  and ((ct.email is null and ct.email_statut = 'introuvable') or ct.email_verif in ('invalid', 'spamtrap', 'abuse', 'do_not_mail'))`;

async function passer(id: number): Promise<Passage> {
  const cle = process.env.PIPECORN_API;
  if (!cle) return { contact_id: id, valeur: null, verif: null, arret: true };
  // Réservation avant l'appel : un webhook et une lecture de secours simultanés ne paient qu'une fois.
  const [c] = await requete<Cible>(
    `update contacts ct set second_passage_le = now() from comptes co
     where ct.id = $1 and co.id = ct.compte_id and not co.exclu and ${EN_ATTENTE}
     returning ct.prenom, ct.nom, ct.url_linkedin, ct.email, ct.suivi->>'ancien_email' as ancien, co.nom as compte,
               coalesce(co.domaine_email, co.domaine) as domaine`, [id]);
  if (!c) return { contact_id: id, valeur: null, verif: null };
  const rendre = () => requete(`update contacts set second_passage_le = null where id = $1`, [id]);
  let d: { email?: string | null; email_status?: string; status?: string; code?: string; error?: string };
  try {
    const r = await fetch(API, {
      method: "POST",
      headers: { "X-API-KEY": cle, "content-type": "application/json" },
      body: JSON.stringify({
        firstname: c.prenom, lastname: c.nom, company_name: c.compte, linkedin_url: c.url_linkedin, enrichment_type: ["email"],
        domain: c.domaine?.replace(/^https?:\/\/(www\.)?/, "").split("/")[0] || undefined, custom: { contact_id: String(id) },
      }),
      signal: AbortSignal.timeout(60000),
    });
    d = await r.json().catch(() => ({}));
    // Crédits épuisés (402) ou limite hebdomadaire (403) : on rend la réservation et on s'arrête, le rattrapage reprendra.
    if (r.status === 402 || r.status === 403) { await rendre(); return { contact_id: id, valeur: null, verif: null, arret: true }; }
    if (!r.ok) { await rendre(); return { contact_id: id, valeur: null, verif: null }; }
  } catch {
    await rendre();
    return { contact_id: id, valeur: null, verif: null };
  }
  await requete(`insert into evenements_bruts (source, charge, origine, traite) values ('pipecorn', $1::jsonb, 'A', true)`,
    [JSON.stringify({ contact_id: id, status: d.status, email_status: d.email_status, email: d.email ?? null })]);
  const email = d.email?.trim().toLowerCase();
  if (!email || [c.email, c.ancien].some((x) => x?.toLowerCase() === email)) return { contact_id: id, valeur: null, verif: null };

  let v: { status: string; sub_status: string | null };
  try {
    v = await valider(email);
  } catch {
    return { contact_id: id, valeur: null, verif: null };
  }
  if (NEGATIFS.has(v.status)) return { contact_id: id, valeur: null, verif: v.status };
  await requete(
    `update contacts set
       suivi = case when email is not null then coalesce(suivi, '{}'::jsonb) || jsonb_build_object('ancien_email', email) else suivi end,
       email = $2, email_source = 'pipecorn', email_statut = $3, email_verif = $4, email_verif_detail = $5, email_verifie_le = now(),
       enrichi_le = coalesce(enrichi_le, now())
     where id = $1`, [id, email, d.email_status ?? null, v.status, v.sub_status]);
  await requete(`update comptes set domaine_email = coalesce(domaine_email, split_part($2, '@', 2)) where id = (select compte_id from contacts where id = $1)`, [id, email]);
  return { contact_id: id, valeur: email, verif: v.status };
}

/** Second passage pour une liste de contacts, par lots de 5 en parallèle, dans le budget de temps donné. */
export async function secondPassage(ids: number[], budgetMs = 120000): Promise<Passage[]> {
  const debut = Date.now();
  const sortie: Passage[] = [];
  for (let i = 0; i < ids.length && Date.now() - debut < budgetMs; i += 5) {
    const lot = await Promise.all(ids.slice(i, i + 5).map(passer));
    sortie.push(...lot);
    if (lot.some((p) => p.arret)) break;
  }
  return sortie;
}

/** Rattrapage quotidien : contacts restés en attente (crédits épuisés le mois précédent, erreur passagère). */
export async function secondPassageEnAttente(budgetMs = 120000): Promise<{ essais: number; trouves: number }> {
  const ids = (await requete<{ id: number }>(
    `select ct.id::int from contacts ct join comptes co on co.id = ct.compte_id where not co.exclu and ${EN_ATTENTE}
     order by ct.enrichi_le desc nulls last limit 50`)).map((l) => l.id);
  const r = await secondPassage(ids, budgetMs);
  return { essais: r.length, trouves: r.filter((p) => p.valeur).length };
}
