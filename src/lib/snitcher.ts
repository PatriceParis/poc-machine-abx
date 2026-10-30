import { requete } from "@/lib/db";
import { hote, rapprocherEntreprise, signalerVisite, type CompteCible } from "@/lib/visites";

// Snitcher : visites de hirondo.co que sa base d'entreprises reconnaît, relevées chaque jour par l'API (installé le
// 30/10/2026 pour comparer avec Leadfeeder et IPinfo Lite). Les sessions donnent les pages, les organisations le nom,
// le site et les profils sociaux. La lecture reprend la veille de la dernière session gardée. Aucune donnée de
// visiteur n'est gardée (ni identifiant ni champ de formulaire).

const API = "https://api.snitcher.com/v1";

type Organisation = { uuid: string; name?: string | null; website?: string | null; profiles?: { name?: string; url?: string }[] | null;
  address?: { country?: string | null } | null };
type Session = {
  uuid: string; organisation_uuid?: string | null; started_at: string; ended_at?: string | null; referrer?: string | null;
  events?: { event_type: string; url?: string }[]; views?: { url?: string }[];
};
type Page<T> = { data?: T[]; last_page?: number };

async function appeler<T>(chemin: string, jeton: string): Promise<T> {
  const r = await fetch(`${API}${chemin}`, { cache: "no-store", headers: { Authorization: `Bearer ${jeton}`, Accept: "application/json" } });
  if (!r.ok) throw new Error(`Snitcher ${r.status} : ${(await r.text()).slice(0, 150)}`);
  return (await r.json()) as T;
}

// Collée depuis un fichier « SNITCHER_API=… », la clé peut garder son nom en tête.
const cle = () => (process.env.SNITCHER_API || process.env.SNITCHER_TOKEN || "").replace(/^SNITCHER_[A-Z]+=/, "").trim();

export async function relireSnitcher(premierPassage = 30) {
  const jeton = cle();
  if (!jeton) return { erreur: "SNITCHER_API absente" };
  const { data: espaces } = await appeler<Page<{ uuid: string; url?: string }>>("/workspaces", jeton);
  const espace = espaces?.find((w) => /hirondo/i.test(w.url ?? "")) ?? espaces?.[0];
  if (!espace) return { erreur: "aucun espace Snitcher" };

  const [d] = await requete<{ le: string | null }>(`select max(debut) as le from visites_outils where outil = 'snitcher'`);
  const depuis = new Date(d?.le ? new Date(d.le).getTime() - 86400000 : Date.now() - premierPassage * 86400000).toISOString().slice(0, 10);
  const lire = async <T>(chemin: string) => {
    const tout: T[] = [];
    for (let page = 1; page <= 25; page++) {
      const r = await appeler<Page<T>>(`/workspaces/${espace.uuid}/${chemin}?date_from=${depuis}&size=1000&page=${page}`, jeton);
      tout.push(...(r.data ?? []));
      if (page >= (r.last_page ?? 1)) break;
    }
    return tout;
  };
  const [sessions, organisations] = [await lire<Session>("sessions"), await lire<Organisation>("organisations")];
  const parUuid = new Map(organisations.map((o) => [o.uuid, o]));
  const comptes = await requete<CompteCible>(`select id::int as id, nom, domaine, site, url_linkedin, effectif from comptes where not exclu`);

  let lues = 0, rapprochees = 0;
  for (const s of sessions) {
    const o = s.organisation_uuid ? parUuid.get(s.organisation_uuid) : undefined;
    const urls = [...(s.events ?? []).filter((e) => e.event_type === "pageview"), ...(s.views ?? [])].map((e) => e.url).filter(Boolean) as string[];
    const pages = [...new Set(urls.map((u) => { try { return new URL(u).pathname; } catch { return u; } }))];
    const linkedin = (o?.profiles ?? []).map((p) => p.url ?? "").filter((u) => /linkedin\.com\/company\//i.test(u));
    const vue = o ? { nom: o.name ?? null, domaine: hote(o.website), linkedin } : null;
    const lien = vue ? rapprocherEntreprise(vue, comptes) : null;
    const duree = s.ended_at ? Math.max(0, Math.round((new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / 1000)) : null;
    await requete(
      `insert into visites_outils (outil, id, debut, entreprise_outil, entreprise, domaine, url_linkedin, effectif, pays, pages, duree_s,
         origine_web, compte_id, rapprochement)
       values ('snitcher', $1, $2, $3, $4, $5, $6, null, $7, $8, $9, $10, $11, $12)
       on conflict (outil, id) do update set pages = excluded.pages, duree_s = excluded.duree_s, compte_id = excluded.compte_id,
         rapprochement = excluded.rapprochement, lu_le = now()`,
      [s.uuid, s.started_at, o?.uuid ?? null, vue?.nom ?? null, vue?.domaine ?? null, linkedin[0] ?? null, o?.address?.country ?? null,
        pages, duree, hote(s.referrer) ?? null, lien?.compte.id ?? null, lien?.par ?? null],
    );
    lues++;
    if (lien) {
      rapprochees++;
      await signalerVisite(lien.compte.id, s.started_at, pages, { page: pages[0] ?? null, entreprise: vue?.nom, par: `Snitcher, ${lien.par}` });
    }
  }
  return { depuis, sessions: lues, entreprises: organisations.length, rapprochees };
}
