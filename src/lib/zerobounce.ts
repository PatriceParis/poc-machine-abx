// ZeroBounce : délivrabilité d'un email trouvé, par le point d'accès européen. 1 crédit par vérification.
// Réservée aux contacts du réservoir A, comme l'enrichissement. Seuls le statut et son détail sont gardés :
// la réponse porte aussi genre, pays ou ville, inutiles ici.
import { requete } from "@/lib/db";

const API = "https://api-eu.zerobounce.net/v2/validate";

export type Verification = { verif: string | null; detail: string | null; erreur?: string };
/** Statuts qui interdisent d'écrire à l'adresse. catch-all et unknown n'en font pas partie. */
export const NEGATIFS = new Set(["invalid", "spamtrap", "abuse", "do_not_mail"]);

/** Vérifie une adresse sans rien écrire en base (1 crédit). Lève une erreur si la vérification n'a pas eu lieu. */
export async function valider(email: string): Promise<{ status: string; sub_status: string | null }> {
  const cle = process.env.ZEROBOUNCE_API;
  if (!cle) throw new Error("ZEROBOUNCE_API absente");
  const r = await fetch(`${API}?api_key=${encodeURIComponent(cle)}&email=${encodeURIComponent(email)}&ip_address=&timeout=20`, { cache: "no-store" });
  const d = (await r.json().catch(() => ({}))) as { status?: string; sub_status?: string; error?: string };
  // Crédits épuisés ou clé refusée : réponse 200 avec un champ error.
  if (!r.ok || !d.status) throw new Error(d.error || `ZeroBounce ${r.status}`);
  return { status: d.status, sub_status: d.sub_status || null };
}

async function credits(cle: string): Promise<number> {
  const r = await fetch(`https://api-eu.zerobounce.net/v2/getcredits?api_key=${encodeURIComponent(cle)}`, { cache: "no-store" });
  const d = (await r.json().catch(() => ({}))) as { Credits?: string };
  return Number(d.Credits ?? 0);
}

/** Rattrapage (tâche planifiée) : emails du réservoir A pas encore vérifiés, ceux trouvés par FullEnrich d'abord,
 *  puis ceux de la base Pharow. Autant que les crédits le permettent, par lots de 5 en parallèle, dans un budget
 *  de 40 secondes. */
export async function verifierEnAttente(limite = 200): Promise<{ verifies: number; restants: number; credits: number }> {
  const cle = process.env.ZEROBOUNCE_API;
  if (!cle) return { verifies: 0, restants: 0, credits: 0 };
  const debut = Date.now();
  const dispo = await credits(cle);
  const attente = await requete<{ id: number }>(
    `select ct.id::int from contacts ct join comptes co on co.id = ct.compte_id
     where ct.origine = 'A' and ct.email is not null and ct.email_verif is null and ct.email_verifie_le is null and not co.exclu
     order by ct.enrichi_le desc nulls last, ct.id limit $1`, [Math.min(limite, dispo)]);
  let verifies = 0;
  let arret = false;
  for (let i = 0; i < attente.length && !arret && Date.now() - debut < 40000; i += 5) {
    const lot = await Promise.all(attente.slice(i, i + 5).map((c) => verifier(c.id)));
    verifies += lot.filter((v) => v.verif).length;
    arret = lot.some((v) => v.erreur);
  }
  const [{ n }] = await requete<{ n: number }>(
    `select count(*)::int as n from contacts ct join comptes co on co.id = ct.compte_id
     where ct.origine = 'A' and ct.email is not null and ct.email_verif is null and not co.exclu`);
  return { verifies, restants: n, credits: dispo - verifies };
}

/** Vérifie l'email du contact s'il n'a jamais été vérifié. Le contact est d'abord réservé (email_verifie_le), pour
 *  qu'un webhook et une lecture de secours simultanés ne paient pas deux fois. Rendu à vide en cas d'échec. */
export async function verifier(contactId: number): Promise<Verification> {
  const cle = process.env.ZEROBOUNCE_API;
  if (!cle) return { verif: null, detail: null, erreur: "ZEROBOUNCE_API absente" };
  const [c] = await requete<{ email: string }>(
    `update contacts set email_verifie_le = now()
     where id = $1 and email is not null and origine = 'A' and email_verifie_le is null
     returning email`, [contactId]);
  if (!c) {
    const [deja] = await requete<{ verif: string | null; detail: string | null }>(
      `select email_verif as verif, email_verif_detail as detail from contacts where id = $1`, [contactId]);
    return deja ?? { verif: null, detail: null };
  }
  try {
    const d = await valider(c.email);
    await requete(`update contacts set email_verif = $2, email_verif_detail = $3 where id = $1`, [contactId, d.status, d.sub_status]);
    return { verif: d.status, detail: d.sub_status };
  } catch (e) {
    await requete(`update contacts set email_verifie_le = null where id = $1`, [contactId]);
    return { verif: null, detail: null, erreur: (e as Error).message };
  }
}
