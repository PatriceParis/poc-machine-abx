import { NextResponse } from "next/server";
import { adressePublique } from "@/lib/adresse";
import { requete } from "@/lib/db";
import { safeEqual } from "@/lib/auth";
import { createHmac, timingSafeEqual } from "node:crypto";
import { lireJeu } from "@/lib/apify";
import { ecrire as ecrireFullEnrich, enrichirAlertes } from "@/lib/fullenrich";
import { interpreterMessage } from "@/lib/reach";
import { interpreterDecideurs, interpreterEngageurs, interpreterOffres, interpreterPostes, referentiel } from "@/lib/releves";

// Réception des webhooks (Brevo, ReachMCP, formulaire du test, LinkedIn, Apify). Secret obligatoire,
// dans l'en-tête x-cle ou le paramètre ?cle=. Tout est d'abord rangé tel quel dans evenements_bruts.
// Sont interprétés ici les relevés Apify et les messages reçus par ReachMCP, leurs formats ayant été lus sur de vraies sorties.
const SOURCES = new Set(["brevo", "reachmcp", "test", "linkedin", "apify", "fullenrich"]);

// FullEnrich signe chaque envoi : HMAC-SHA1 du corps brut avec la clé API, en hexadécimal, en-tête X-Signature-SHA1.
function signatureFullEnrich(corps: string, signature: string | null) {
  const k = process.env.FULLENRICH_API;
  if (!k || !signature) return false;
  const attendu = createHmac("sha1", k).update(corps, "utf8").digest("hex");
  return attendu.length === signature.length && timingSafeEqual(Buffer.from(attendu), Buffer.from(signature));
}
export const maxDuration = 300;

export async function POST(request: Request, { params }: { params: Promise<{ source: string }> }) {
  const { source } = await params;
  if (!SOURCES.has(source)) return NextResponse.json({ ok: false }, { status: 404 });
  const secret = process.env.WEBHOOK_SECRET || "";
  const url = new URL(request.url);
  const donne = request.headers.get("x-cle") || url.searchParams.get("cle") || "";
  if (!secret || !safeEqual(donne, secret)) return NextResponse.json({ ok: false }, { status: 401 });

  const texte = await request.text();
  if (source === "fullenrich") {
    if (!signatureFullEnrich(texte, request.headers.get("x-signature-sha1"))) return NextResponse.json({ ok: false }, { status: 401 });
    await ecrireFullEnrich(JSON.parse(texte));
    return NextResponse.json({ ok: true });
  }
  let charge: Record<string, unknown>;
  try {
    charge = JSON.parse(texte);
  } catch {
    charge = { texte };
  }
  if (source === "reachmcp") {
    // Le texte d'un message privé n'est jamais gardé : seul compte le fait qu'une personne d'un compte cible ait écrit.
    const data = { ...((charge.data as Record<string, unknown>) ?? {}) };
    delete data.last_message_text;
    await requete(`insert into evenements_bruts (source, charge, origine) values ('reachmcp', $1::jsonb, 'C')`, [JSON.stringify({ ...charge, data })]);
    const nouveaux = charge.type === "message.received" ? await interpreterMessage(data).catch(() => 0) : 0;
    return NextResponse.json({ ok: true, nouveaux });
  }
  if (source !== "apify") {
    await requete(`insert into evenements_bruts (source, charge, origine) values ($1, $2::jsonb, 'C')`, [source, JSON.stringify(charge)]);
    return NextResponse.json({ ok: true });
  }
  const retour = `${adressePublique(request)}/api/webhook/fullenrich?cle=${encodeURIComponent(secret)}`;
  return NextResponse.json(await finDeRun(charge, retour));
}

async function finDeRun(charge: Record<string, unknown>, retourFullEnrich: string) {
  const run = charge.resource as { id?: string; status?: string; defaultDatasetId?: string; usageTotalUsd?: number } | undefined;
  if (!run?.id) return { ok: false, raison: "run absent" };
  const [releve] = await requete<{ id: number; nature: string; detail: Record<string, unknown>; statut: string }>(
    `select id::int, nature, detail, statut from releves where run_id = $1`, [run.id]);
  if (!releve) return { ok: false, raison: "run inconnu" };
  if (releve.statut === "terminé") return { ok: true, deja: true };
  if (run.status !== "SUCCEEDED" || !run.defaultDatasetId) {
    await requete(`update releves set statut = 'échec', termine_le = now(), erreur = $2 where id = $1`, [releve.id, run.status ?? "inconnu"]);
    return { ok: true, statut: run.status };
  }
  try {
    const items = await lireJeu(run.defaultDatasetId);
    // Rangement brut, une ligne par élément, dédoublonné par clé (même personne, même relevé du mois).
    const mois = new Date().toISOString().slice(0, 7);
    const cles = items.map((it, i) => `${releve.nature}:${releve.detail?.type ?? ""}:${String(it.id ?? (it.actor as { id?: string })?.id ?? (it.originalQuery as { url?: string })?.url ?? i)}:${mois}`);
    await requete(
      `insert into evenements_bruts (source, charge, origine, traite)
       select 'apify', jsonb_build_object('cle', v.k, 'nature', $3::text, 'run', $4::text, 'element', v.e::jsonb), $5::origine_donnee, true
       from unnest($1::text[], $2::text[]) as v(k, e)
       on conflict (source, (charge->>'cle')) where charge->>'cle' is not null do nothing`,
      // Les engageurs d'un post sont des données de campagne (C) ; la surveillance des décideurs relève du réservoir A.
      [cles, items.map((it) => JSON.stringify(it)), releve.nature, run.id, releve.nature === "engageurs" ? "C" : "A"]);
    const ref = await referentiel();
    let nouveaux = 0;
    if (releve.nature === "postes") nouveaux = await interpreterPostes(items, ref);
    else if (releve.nature === "manquants") nouveaux = await interpreterPostes(items, ref, true);
    else if (releve.nature === "offres") nouveaux = await interpreterOffres(items, ref);
    else if (releve.nature === "decideurs") nouveaux = await interpreterDecideurs(items, ref);
    else if (releve.nature === "engageurs") {
      const d = releve.detail as { post: { url: string; nature: string }; type: "reactions" | "commentaires" };
      nouveaux = await interpreterEngageurs(items, d.post, d.type, ref);
    }
    await requete(
      `update releves set statut = 'terminé', termine_le = now(), elements = $2, nouveaux_signaux = $3,
              detail = detail || jsonb_build_object('cout_usd', $4::numeric) where id = $1`,
      [releve.id, items.length, nouveaux, run.usageTotalUsd ?? null]);
    // Un nouveau décideur arrive avec son email cherché (1 crédit FullEnrich s'il est trouvé). Un échec ici ne
    // remet pas en cause le relevé, déjà enregistré.
    let emails = 0;
    if (["postes", "manquants", "decideurs"].includes(releve.nature)) {
      emails = await enrichirAlertes(retourFullEnrich).catch(() => 0);
    }
    return { ok: true, elements: items.length, nouveaux, emails };
  } catch (e) {
    await requete(`update releves set statut = 'échec', termine_le = now(), erreur = $2 where id = $1`, [releve.id, String((e as Error).message).slice(0, 300)]);
    return { ok: false };
  }
}
