import { NextResponse } from "next/server";
import { requete } from "@/lib/db";

// Recherche d'email ou de téléphone d'un contact par FullEnrich, à la demande (bouton de la fiche compte).
// Réservée aux contacts sourcés par Flow Ops (réservoir A) : une donnée de campagne (C) ou du CRM Hirondo (B)
// ne part pas dans une cascade d'enrichissement tierce sans accord écrit (NDA, article 9).
// Coût : 1 crédit pour un email professionnel, 10 pour un mobile. La route est protégée par la session.
const API = "https://app.fullenrich.com/api/v2/contact/enrich/bulk";
const CHAMPS = { email: "contact.work_emails", telephone: "contact.phones" } as const;
type Champ = keyof typeof CHAMPS;

function cle() {
  const k = process.env.FULLENRICH_API;
  if (!k) throw new Error("FULLENRICH_API absente");
  return k;
}

export async function POST(request: Request) {
  const { contact_id, champ } = (await request.json()) as { contact_id?: number; champ?: Champ };
  if (!contact_id || !champ || !(champ in CHAMPS)) return NextResponse.json({ erreur: "requête incomplète" }, { status: 400 });
  const [c] = await requete<{ prenom: string | null; nom: string | null; url_linkedin: string | null; origine: string; compte: string | null; domaine: string | null }>(
    `select ct.prenom, ct.nom, ct.url_linkedin, ct.origine::text, co.nom as compte, co.domaine
     from contacts ct left join comptes co on co.id = ct.compte_id where ct.id = $1`, [contact_id]);
  if (!c) return NextResponse.json({ erreur: "contact introuvable" }, { status: 404 });
  if (c.origine !== "A") return NextResponse.json({ erreur: "Contact issu de la campagne ou du CRM Hirondo : pas d'enrichissement tiers sans accord écrit." }, { status: 403 });

  const contact: Record<string, unknown> = { enrich_fields: [CHAMPS[champ]], custom: { contact_id: String(contact_id) } };
  if (c.url_linkedin?.includes("linkedin.com/in/")) contact.linkedin_url = c.url_linkedin;
  if (c.prenom && c.nom) Object.assign(contact, { first_name: c.prenom, last_name: c.nom });
  if (c.domaine) contact.domain = c.domaine;
  if (c.compte) contact.company_name = c.compte;

  const r = await fetch(API, {
    method: "POST",
    headers: { authorization: `Bearer ${cle()}`, "content-type": "application/json" },
    body: JSON.stringify({ name: `${c.prenom ?? ""} ${c.nom ?? ""} · ${champ}`.trim(), data: [contact] }),
  });
  const d = (await r.json().catch(() => ({}))) as { enrichment_id?: string; message?: string };
  if (!r.ok || !d.enrichment_id) return NextResponse.json({ erreur: d.message ?? `FullEnrich ${r.status}` }, { status: 502 });
  return NextResponse.json({ enrichment_id: d.enrichment_id });
}

type Resultat = {
  status?: string;
  code?: string;
  data?: { custom?: { contact_id?: string }; contact_info?: {
    most_probable_work_email?: { email?: string; status?: string };
    most_probable_phone?: { number?: string; line_status?: string };
  } }[];
};

export async function GET(request: Request) {
  const u = new URL(request.url);
  const id = u.searchParams.get("id") || "";
  const contactId = Number(u.searchParams.get("contact"));
  const champ = u.searchParams.get("champ") as Champ;
  if (!/^[0-9a-f-]{36}$/i.test(id) || !contactId || !(champ in CHAMPS)) return NextResponse.json({ erreur: "requête incomplète" }, { status: 400 });

  const r = await fetch(`${API}/${id}`, { headers: { authorization: `Bearer ${cle()}` }, cache: "no-store" });
  const d = (await r.json().catch(() => ({}))) as Resultat;
  if (d.code === "error.enrichment.in_progress" || (d.status && d.status !== "FINISHED")) return NextResponse.json({ statut: "en cours" });
  if (!r.ok) return NextResponse.json({ erreur: `FullEnrich ${r.status}` }, { status: 502 });

  // Résultat brut gardé (réservoir A, contact sourcé par Flow Ops), puis la valeur la plus probable dans la fiche.
  await requete(`insert into evenements_bruts (source, charge, origine, traite) values ('fullenrich', $1::jsonb, 'A', true)`,
    [JSON.stringify({ enrichment_id: id, contact_id: contactId, champ, resultat: d })]);
  const info = d.data?.[0]?.contact_info;
  if (champ === "email") {
    const e = info?.most_probable_work_email;
    await requete(`update contacts set email = coalesce($2, email), email_statut = coalesce($3, email_statut), enrichi_le = now() where id = $1`,
      [contactId, e?.email ?? null, e?.status ?? null]);
    return NextResponse.json({ statut: "terminé", valeur: e?.email ?? null, detail: e?.status ?? null });
  }
  const t = info?.most_probable_phone;
  await requete(`update contacts set telephone = coalesce($2, telephone), enrichi_le = now() where id = $1`, [contactId, t?.number ?? null]);
  return NextResponse.json({ statut: "terminé", valeur: t?.number ?? null, detail: t?.line_status ?? null });
}
