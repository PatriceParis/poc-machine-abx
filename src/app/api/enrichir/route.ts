import { NextResponse } from "next/server";
import { requete } from "@/lib/db";
import { CHAMPS, contactsAEnrichir, ecrire, enrichirAlertes, lancer, lire, termine, type Champ } from "@/lib/fullenrich";

// Recherche d'email ou de téléphone par FullEnrich, à la demande (fiche compte). Un contact, ou d'un coup tous les
// décideurs marketing d'un compte qui n'en ont pas. Réservée aux contacts sourcés par Flow Ops (réservoir A) :
// une donnée de campagne (C) ou du CRM Hirondo (B) ne part pas dans une cascade d'enrichissement tierce sans
// accord écrit (NDA, article 9). Coût : 1 crédit par email trouvé, 10 par mobile trouvé. Route protégée par la session.
const DECIDEUR = "(cmo|chief marketing|directeur.*marketing|directrice.*marketing|marketing director|director of marketing|head of marketing|vp marketing|directeur.*communication|directrice.*communication|chief brand|chief growth|head of growth)";

export async function POST(request: Request) {
  const { contact_id, compte_id, champ, alertes } = (await request.json()) as { contact_id?: number; compte_id?: number; champ?: Champ; alertes?: boolean };
  const retour = `${new URL("/api/webhook/fullenrich", request.url).toString()}?cle=${encodeURIComponent(process.env.WEBHOOK_SECRET || "")}`;
  // Rattrapage : emails des contacts des alertes « nouveau décideur » jamais cherchés (fait aussi après chaque relevé).
  if (alertes) {
    try {
      return NextResponse.json({ n: await enrichirAlertes(retour) });
    } catch (e) {
      return NextResponse.json({ erreur: (e as Error).message }, { status: 502 });
    }
  }
  if (!champ || !(champ in CHAMPS) || (!contact_id && !compte_id)) return NextResponse.json({ erreur: "requête incomplète" }, { status: 400 });

  if (contact_id) {
    const [o] = await requete<{ origine: string }>(`select origine::text from contacts where id = $1`, [contact_id]);
    if (!o) return NextResponse.json({ erreur: "contact introuvable" }, { status: 404 });
    if (o.origine !== "A") return NextResponse.json({ erreur: "Contact issu de la campagne ou du CRM Hirondo : pas d'enrichissement tiers sans accord écrit." }, { status: 403 });
  }
  const manque = champ === "email" ? "ct.email is null" : "ct.telephone is null";
  const contacts = contact_id
    ? await contactsAEnrichir(`ct.id = $1`, [contact_id])
    : await contactsAEnrichir(`ct.compte_id = $1 and ${manque} and ct.poste ~* '${DECIDEUR}'`, [compte_id]);
  if (!contacts.length) return NextResponse.json({ erreur: "Aucun contact à chercher" }, { status: 404 });

  const nom = contact_id ? `${contacts[0].prenom ?? ""} ${contacts[0].nom ?? ""} · ${champ}`.trim() : `${contacts[0].compte ?? "Compte"} · décideurs · ${champ}`;
  try {
    return NextResponse.json({ enrichment_id: await lancer(contacts, champ, nom, retour), n: contacts.length });
  } catch (e) {
    return NextResponse.json({ erreur: (e as Error).message }, { status: 502 });
  }
}

// Lecture de secours, quand la page attend encore : le webhook écrit de toute façon le résultat.
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ erreur: "requête incomplète" }, { status: 400 });
  const d = await lire(id);
  if (d.code === "error.enrichment.in_progress" || !termine(d)) return NextResponse.json({ statut: "en cours" });
  const resultats = await ecrire(d);
  return NextResponse.json({ statut: "terminé", resultats });
}
