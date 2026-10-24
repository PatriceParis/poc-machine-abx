// ZeroBounce : délivrabilité d'un email trouvé, par le point d'accès européen. 1 crédit par vérification.
// Réservée aux contacts du réservoir A, comme l'enrichissement. Seuls le statut et son détail sont gardés :
// la réponse porte aussi genre, pays ou ville, inutiles ici.
import { requete } from "@/lib/db";

const API = "https://api-eu.zerobounce.net/v2/validate";

export type Verification = { verif: string | null; detail: string | null; erreur?: string };

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
    const r = await fetch(`${API}?api_key=${encodeURIComponent(cle)}&email=${encodeURIComponent(c.email)}&ip_address=&timeout=20`, { cache: "no-store" });
    const d = (await r.json().catch(() => ({}))) as { status?: string; sub_status?: string; error?: string };
    // Crédits épuisés ou clé refusée : réponse 200 avec un champ error.
    if (!r.ok || !d.status) throw new Error(d.error || `ZeroBounce ${r.status}`);
    await requete(`update contacts set email_verif = $2, email_verif_detail = nullif($3, '') where id = $1`, [contactId, d.status, d.sub_status ?? ""]);
    return { verif: d.status, detail: d.sub_status || null };
  } catch (e) {
    await requete(`update contacts set email_verifie_le = null where id = $1`, [contactId]);
    return { verif: null, detail: null, erreur: (e as Error).message };
  }
}
