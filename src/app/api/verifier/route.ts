import { NextResponse } from "next/server";
import { verifier } from "@/lib/zerobounce";

// Vérification ZeroBounce à la demande, pour un email déjà présent (base Pharow) ou dont la vérification a échoué.
// Les emails trouvés par FullEnrich sont vérifiés d'office. Route protégée par la session.
export async function POST(request: Request) {
  const { contact_id } = (await request.json()) as { contact_id?: number };
  if (!contact_id) return NextResponse.json({ erreur: "requête incomplète" }, { status: 400 });
  const v = await verifier(contact_id);
  return NextResponse.json(v, { status: v.erreur ? 502 : 200 });
}
