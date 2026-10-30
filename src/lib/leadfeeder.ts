import { requete } from "@/lib/db";
import { hote, rapprocherEntreprise, signalerVisite, type CompteCible } from "@/lib/visites";

// Leadfeeder (Dealfront) : visites de hirondo.co que sa base d'entreprises reconnaît, relevées chaque jour par l'API.
// La lecture reprend la veille de la dernière visite gardée, car une session peut s'allonger après un relevé. Ni nom
// ni email de visiteur ne sont gardés. Une entreprise rapprochée d'un compte de la base fait les signaux de visite.

const API = "https://api.leadfeeder.com/v1";

type Entreprise = {
  name?: string; url?: string | null; alternative_urls?: string[]; employee_count?: number | null;
  address?: { country_code?: string } | null; social_media_profiles?: { linkedin?: { url: string }[] } | null;
};
type Visite = {
  id: string;
  attributes: {
    started_at: string; source: string | null; referring_url: string | null; visit_length: number | null;
    engagements?: { event_type: string; page?: { path?: string } }[];
  };
  relationships?: { company?: { id: string; attributes: Entreprise } };
};

async function appeler<T>(chemin: string, cle: string, corps?: unknown): Promise<T> {
  const r = await fetch(`${API}${chemin}`, {
    method: corps ? "POST" : "GET", cache: "no-store", body: corps ? JSON.stringify(corps) : undefined,
    headers: { "X-Api-Key": cle, "Content-Type": "application/json" },
  });
  if (!r.ok) throw new Error(`Leadfeeder ${r.status} : ${(await r.text()).slice(0, 150)}`);
  return (await r.json()) as T;
}

export async function relireLeadfeeder(premierPassage = 30) {
  const cle = process.env.LEADFEEDER_API;
  if (!cle) return { erreur: "LEADFEEDER_API absente" };
  const { data: comptesLf } = await appeler<{ data: { id: string }[] }>("/accounts", cle);
  if (!comptesLf[0]) return { erreur: "aucun compte Leadfeeder" };

  const [d] = await requete<{ le: string | null }>(`select max(debut) as le from visites_outils where outil = 'leadfeeder'`);
  const debut = new Date(d?.le ? new Date(d.le).getTime() - 86400000 : Date.now() - premierPassage * 86400000);
  const periode = { start_date: debut.toISOString().slice(0, 10), end_date: new Date().toISOString().slice(0, 10) };
  const comptes = await requete<CompteCible>(`select id::int as id, nom, domaine, site, url_linkedin, effectif from comptes where not exclu`);

  let lues = 0, rapprochees = 0;
  for (let page = 1; page <= 50; page++) {
    const r = await appeler<{ data: Visite[]; meta?: { pagination?: { page_count?: number } } }>(
      `/web-visits?account_id=${encodeURIComponent(comptesLf[0].id)}&include=company&page[num]=${page}&page[size]=100`, cle, periode);
    for (const v of r.data) {
      const a = v.attributes;
      // Le contrôle d'installation fait par Leadfeeder lui-même n'est pas une visite.
      if (/leadfeeder|dealfront/i.test(`${a.source ?? ""} ${a.referring_url ?? ""}`)) continue;
      const e = v.relationships?.company?.attributes;
      const pages = [...new Set((a.engagements ?? []).filter((x) => x.event_type === "page-view").map((x) => x.page?.path).filter(Boolean) as string[])];
      const vue = e ? {
        nom: e.name ?? null, domaine: hote(e.url),
        linkedin: (e.social_media_profiles?.linkedin ?? []).map((l) => l.url),
      } : null;
      const lien = vue ? rapprocherEntreprise(vue, comptes) : null;
      await requete(
        `insert into visites_outils (outil, id, debut, entreprise_outil, entreprise, domaine, url_linkedin, effectif, pays, pages, duree_s,
           origine_web, compte_id, rapprochement)
         values ('leadfeeder', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         on conflict (outil, id) do update set pages = excluded.pages, duree_s = excluded.duree_s, compte_id = excluded.compte_id,
           rapprochement = excluded.rapprochement, lu_le = now()`,
        [v.id, a.started_at, v.relationships?.company?.id ?? null, vue?.nom ?? null, vue?.domaine ?? null, vue?.linkedin[0] ?? null,
          e?.employee_count ?? null, e?.address?.country_code ?? null, pages, a.visit_length ?? null, a.source ?? null,
          lien?.compte.id ?? null, lien?.par ?? null],
      );
      lues++;
      if (lien) {
        rapprochees++;
        await signalerVisite(lien.compte.id, a.started_at, pages, { page: pages[0] ?? null, entreprise: vue?.nom, par: `Leadfeeder, ${lien.par}` });
      }
    }
    if (page >= (r.meta?.pagination?.page_count ?? 1)) break;
  }
  return { depuis: periode.start_date, visites: lues, rapprochees };
}
