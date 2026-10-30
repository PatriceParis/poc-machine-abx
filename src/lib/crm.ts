import { requete } from "@/lib/db";
import { hote, rapprocherEntreprise, type CompteCible } from "@/lib/visites";

// CRM Notion de Hirondo, relu chaque semaine au niveau de l'entreprise : aucun contact du CRM n'entre dans la base ni
// dans l'enrichissement. Seules les colonnes utiles sont demandées à Notion (filter_properties) : les coordonnées
// bancaires des fiches ne quittent jamais Notion. Une mission gagnée récente fait « membre Hirondo en mission », une
// opportunité perdue pour une raison réversible et sans contact depuis longtemps fait « contact dormant », une
// opportunité en cours marque le compte « déjà dans le pipeline Hirondo » (aucun point, jamais transmis).

const API = "https://api.notion.com/v1";

type Propriete = { type: string; [cle: string]: unknown };
type Fiche = { id: string; created_time: string; p: Record<string, Propriete> };

async function notion<T>(chemin: string, jeton: string, corps?: unknown): Promise<T> {
  const r = await fetch(`${API}${chemin}`, {
    method: corps ? "POST" : "GET", cache: "no-store", body: corps ? JSON.stringify(corps) : undefined,
    headers: { Authorization: `Bearer ${jeton}`, "Notion-Version": "2022-06-28", "Content-Type": "application/json" },
  });
  if (!r.ok) throw new Error(`Notion ${r.status} : ${(await r.text()).slice(0, 150)}`);
  return (await r.json()) as T;
}

/** Toutes les fiches d'une base, réduites au titre et aux colonnes demandées. */
async function lireBase(jeton: string, id: string, colonnes: string[]): Promise<Fiche[]> {
  const schema = await notion<{ properties: Record<string, { id: string; type: string }> }>(`/databases/${id}`, jeton);
  const voulues = Object.entries(schema.properties).filter(([nom, v]) => v.type === "title" || colonnes.includes(nom));
  const qs = voulues.map(([, v]) => `filter_properties=${encodeURIComponent(v.id)}`).join("&");
  const fiches: Fiche[] = [];
  let curseur: string | null = null;
  do {
    const r: { results: { id: string; created_time: string; properties: Record<string, Propriete> }[]; has_more: boolean; next_cursor: string | null } =
      await notion(`/databases/${id}/query?${qs}`, jeton, { page_size: 100, ...(curseur ? { start_cursor: curseur } : {}) });
    fiches.push(...r.results.map((x) => ({ id: x.id, created_time: x.created_time, p: x.properties })));
    curseur = r.has_more ? r.next_cursor : null;
  } while (curseur);
  return fiches;
}

const texte = (p?: Propriete): string | null => {
  if (!p) return null;
  if (p.type === "title") return (p.title as { plain_text: string }[]).map((x) => x.plain_text).join("") || null;
  if (p.type === "url") return (p.url as string | null) ?? null;
  if (p.type === "status" || p.type === "select") return (p[p.type] as { name: string } | null)?.name ?? null;
  if (p.type === "date") return (p.date as { start: string } | null)?.start ?? null;
  return null;
};
const titre = (f: Fiche) => texte(Object.values(f.p).find((v) => v.type === "title"));

type Opp = { statut: string | null; perte: string | null; le: string };
type Etat = { crm: string; nom: string; opps: Opp[] };

export async function relireCrm() {
  const jeton = process.env.NOTION_HIRONDO_TOKEN || process.env.NOTION_TOKEN;
  if (!jeton) return { erreur: "NOTION_HIRONDO_TOKEN absente" };
  const params = new Map((await requete<{ cle: string; valeur: unknown }>(`select cle, valeur from parametres where cle like 'crm\\_%'`))
    .map((p) => [p.cle, p.valeur]));
  const baseEntreprises = params.get("crm_notion_entreprises") as string | undefined;
  const baseOpps = params.get("crm_notion_opportunites") as string | undefined;
  if (!baseEntreprises || !baseOpps) return { erreur: "bases du CRM non configurées" };
  const moisMission = Number(params.get("crm_mission_mois") ?? 12);
  const joursDormant = Number(params.get("crm_dormant_jours") ?? 90);
  const pertesExclues = new Set((params.get("crm_pertes_exclues") as string[] | undefined) ?? []);
  const enCours = (params.get("crm_statuts_en_cours") as string[] | undefined) ?? [];

  const [entreprises, opps] = await Promise.all([
    lireBase(jeton, baseEntreprises, ["Website", "LinkedIn"]),
    lireBase(jeton, baseOpps, ["Company", "Status", "Loss reason", "Last touch"]),
  ]);
  const parEntreprise = new Map<string, Opp[]>();
  for (const o of opps) {
    const opp = { statut: texte(o.p.Status), perte: texte(o.p["Loss reason"]), le: texte(o.p["Last touch"]) ?? o.created_time };
    for (const r of (o.p.Company?.relation as { id: string }[] | undefined) ?? []) parEntreprise.set(r.id, [...(parEntreprise.get(r.id) ?? []), opp]);
  }

  const comptes = await requete<CompteCible>(`select id::int as id, nom, domaine, site, url_linkedin, effectif from comptes where not exclu`);
  const etats = new Map<number, Etat>();
  for (const e of entreprises) {
    const os = parEntreprise.get(e.id);
    if (!os?.length) continue;
    const linkedin = texte(e.p.LinkedIn);
    const lien = rapprocherEntreprise({ nom: titre(e), domaine: hote(texte(e.p.Website)), linkedin: linkedin ? [linkedin] : [] }, comptes);
    if (!lien) continue;
    const etat = etats.get(lien.compte.id) ?? { crm: e.id, nom: titre(e) ?? "", opps: [] };
    etat.opps.push(...os);
    etats.set(lien.compte.id, etat);
  }

  const maintenant = Date.now();
  const voulus: { type: string; compte: number; ref: string; le: string; detail: Record<string, unknown> }[] = [];
  const pipelines: { compte: number; statut: string | null; crm: string }[] = [];
  for (const [compte, etat] of etats) {
    const dernier = (l: Opp[]) => l.map((o) => o.le).sort().pop() ?? null;
    const gagnees = etat.opps.filter((o) => o.statut === "Won");
    const ouvertes = etat.opps.filter((o) => o.statut && enCours.includes(o.statut));
    const mission = dernier(gagnees);
    const recente = mission && maintenant - new Date(mission).getTime() <= moisMission * 30.4 * 86400000;
    const statut = ouvertes.length ? enCours[Math.max(...ouvertes.map((o) => enCours.indexOf(o.statut!)))] : null;
    pipelines.push({ compte, statut, crm: etat.crm });
    if (recente) {
      voulus.push({ type: "membre_hirondo_en_mission", compte, ref: `crm:mission:${compte}`, le: mission!,
        detail: { entreprise: etat.nom, missions: gagnees.length, dernier_contact: mission } });
      continue;
    }
    const perdues = etat.opps.filter((o) => o.statut === "Lost" || o.statut === "Postponed");
    const activite = dernier(etat.opps);
    if (!statut && perdues.length && !perdues.some((o) => o.perte && pertesExclues.has(o.perte))
      && activite && maintenant - new Date(activite).getTime() >= joursDormant * 86400000) {
      voulus.push({ type: "contact_dormant_crm", compte, ref: `crm:dormant:${compte}`, le: activite,
        detail: { entreprise: etat.nom, perdues: perdues.length, raisons: [...new Set(perdues.map((o) => o.perte).filter(Boolean))], dernier_contact: activite } });
    }
  }

  for (const s of voulus) {
    await requete(
      `insert into signaux (type_code, compte_id, survenu_le, source, ref_externe, detail, origine)
       values ($1, $2, $3, 'crm', $4, $5::jsonb, 'B')
       on conflict (source, ref_externe) do update set type_code = excluded.type_code, survenu_le = excluded.survenu_le, detail = excluded.detail`,
      [s.type, s.compte, s.le, s.ref, JSON.stringify(s.detail)],
    );
  }
  const retires = await requete(`delete from signaux where source = 'crm' and not (ref_externe = any($1::text[])) returning id`, [voulus.map((s) => s.ref)]);
  await requete(`update comptes set pipeline_hirondo = null, crm_id = null, crm_relu_le = null where crm_id is not null or pipeline_hirondo is not null`);
  for (const p of pipelines) {
    await requete(`update comptes set pipeline_hirondo = $2, crm_id = $3, crm_relu_le = now() where id = $1`, [p.compte, p.statut, p.crm]);
  }
  return {
    entreprises: entreprises.length, opportunites: opps.length, comptes: etats.size,
    missions: voulus.filter((s) => s.type === "membre_hirondo_en_mission").length,
    dormants: voulus.filter((s) => s.type === "contact_dormant_crm").length,
    pipeline: pipelines.filter((p) => p.statut).length, retires: retires.length,
  };
}
