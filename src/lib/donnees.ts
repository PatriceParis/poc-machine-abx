import { requete } from "@/lib/db";

// Toutes les lectures de la base. Les vues score_comptes et signaux_actifs font le calcul ; ici on ne fait que lire.

export type LigneCompte = {
  compte_id: number;
  nom: string;
  activite: string | null;
  tranche_effectif: string | null;
  code_postal?: string | null;
  palier: "A" | "B" | "C";
  engagement: "chaud" | "tiede" | "froid";
  score: number;
  adequation: number;
  chaleur: number;
  malus: number;
  action: string;
  dernier_signal: string | null;
  nb_signaux: number;
  contacts: number;
};

const COLONNES_COMPTE = `s.compte_id::int as compte_id, s.nom, s.activite, s.tranche_effectif, s.palier, s.engagement,
  s.score, s.adequation, s.chaleur, s.malus, s.action, s.dernier_signal,
  (s.nb_declencheur + s.nb_intention)::int as nb_signaux,
  (select count(*)::int from contacts c where c.compte_id = s.compte_id) as contacts`;

// Sources de la machine : chacune est reconnue à ses types de signal ou à ses événements bruts.
export const SOURCES = [
  { cle: "pharow", nom: "Base de ciblage Pharow", detail: "comptes, contacts et adéquation", nature: "Import", types: [] as string[], evenements: null as string | null },
  { cle: "postes", nom: "Prises de poste et départs", detail: "Apify, relevé mensuel des décideurs", nature: "Machine", types: ["nouveau_decideur_marketing", "depart_decideur_marketing", "champion_arrive"], evenements: null },
  { cle: "engageurs", nom: "Engageurs des posts LinkedIn", detail: "Apify, posts de Yannig, Gilles et des pairs", nature: "Machine", types: ["engagement_post", "commentaire_roadmap", "engagement_pairs"], evenements: "apify" },
  { cle: "site", nom: "Visites de hirondo.co", detail: "script maison et IPinfo Lite", nature: "Machine", types: ["visite_site", "visite_page_cle", "visites_repetees"], evenements: "site" },
  { cle: "offres", nom: "Offres d'emploi marketing ops", detail: "Apify, relevé hebdomadaire", nature: "Machine", types: ["recrutement_marketing_ops"], evenements: null },
  { cle: "test", nom: "Test de maturité ABM", detail: "formulaire, webhook", nature: "Webhook", types: ["test_complete", "test_profil_outils"], evenements: "test" },
  { cle: "linkedin", nom: "LinkedIn Ads", detail: "formulaires, vidéo, entreprises engagées", nature: "API", types: ["formulaire_natif", "video_50", "entreprise_engagee_pub"], evenements: "linkedin" },
  { cle: "brevo", nom: "Emails Brevo", detail: "ouvertures, clics, réponses", nature: "Webhook", types: ["email_ouvert_2x", "clic_lien", "email_reponse"], evenements: "brevo" },
  { cle: "reachmcp", nom: "ReachMCP", detail: "visites de profil, réponses LinkedIn", nature: "Webhook", types: ["visite_profil", "reponse_linkedin"], evenements: "reachmcp" },
  { cle: "crm", nom: "CRM Notion Hirondo", detail: "membres en mission, dormants", nature: "Import", types: ["membre_hirondo_en_mission", "contact_dormant_crm"], evenements: null },
];

export async function cockpit() {
  const [chiffres] = await requete<Record<string, number | string | null>>(`
    with chaleur as (
      select s.survenu_le, t.famille from signaux s join types_signal t on t.code = s.type_code
      where t.famille in ('declencheur', 'intention'))
    select
      (select count(*)::int from comptes where not exclu) as comptes,
      (select count(*)::int from contacts) as contacts,
      (select count(*)::int from contacts where fonction in ('marketing', 'growth', 'direction_generale')) as contacts_cibles,
      (select count(*)::int from chaleur) as signaux_total,
      (select count(*)::int from chaleur where survenu_le >= now() - interval '30 days') as signaux_30,
      (select count(*)::int from chaleur where famille = 'intention' and survenu_le >= now() - interval '30 days') as intentions_30,
      (select count(*)::int from chaleur where famille = 'declencheur' and survenu_le >= now() - interval '30 days') as declencheurs_30,
      (select count(*)::int from comptes_a_notifier) as a_traiter,
      (select count(*)::int from comptes_a_notifier where action = 'Alerte nouveau décideur') as a_traiter_alertes,
      (select count(*)::int from comptes_a_notifier where action = 'Transmettre') as a_traiter_transmettre,
      (select count(*)::int from evenements_bruts where source = 'site') as visites,
      (select count(*)::int from evenements_bruts where source = 'site' and charge->>'compte_id' is not null) as visites_identifiees,
      (select max(mis_a_jour_le) from comptes) as dernier_import`);
  const matrice = await requete<{ palier: string; engagement: string; n: number }>(
    `select palier, engagement, count(*)::int as n from score_comptes where not exclu group by 1, 2`);
  const top = await requete<LigneCompte>(
    `select ${COLONNES_COMPTE} from score_comptes s where not s.exclu order by s.score desc, s.nom limit 12`);
  const actions = await requete<{ action: string; n: number }>(
    `select action, count(*)::int as n from score_comptes where not exclu group by 1 order by 2 desc`);
  const parType = await requete<{ type_code: string; n: number; n30: number; dernier: string | null }>(
    `select type_code, count(*)::int as n,
            (count(*) filter (where survenu_le >= now() - interval '30 days'))::int as n30, max(survenu_le) as dernier
     from signaux group by 1`);
  const parEvenement = await requete<{ source: string; n: number; dernier: string | null }>(
    `select source, count(*)::int as n, max(recu_le) as dernier from evenements_bruts group by 1`);
  const familles30 = await requete<{ famille: string; n: number }>(
    `select t.famille, count(*)::int as n from signaux s join types_signal t on t.code = s.type_code
     where t.famille in ('declencheur', 'intention') and s.survenu_le >= now() - interval '30 days' group by 1`);

  const types = new Map(parType.map((l) => [l.type_code, l]));
  const evts = new Map(parEvenement.map((l) => [l.source, l]));
  const sources = SOURCES.map((s) => {
    const n = s.cle === "pharow" ? Number(chiffres.comptes) : s.types.reduce((acc, t) => acc + (types.get(t)?.n ?? 0), 0);
    const nEvt = s.evenements ? evts.get(s.evenements)?.n ?? 0 : 0;
    return { ...s, n, nEvt, actif: n > 0 || nEvt > 0 };
  });
  return { chiffres, matrice, top, actions, sources, familles30 };
}

export type FiltresComptes = { palier?: string; engagement?: string; activite?: string; texte?: string; action?: string; traiter?: string; page: number };

export async function listeComptes(f: FiltresComptes) {
  const conditions = ["not s.exclu"];
  const params: unknown[] = [];
  if (f.palier) { params.push(f.palier); conditions.push(`s.palier = $${params.length}`); }
  if (f.engagement) { params.push(f.engagement); conditions.push(`s.engagement = $${params.length}`); }
  if (f.activite) { params.push(f.activite); conditions.push(`s.activite = $${params.length}`); }
  if (f.texte) { params.push(`%${f.texte}%`); conditions.push(`s.nom ilike $${params.length}`); }
  if (f.action) { params.push(f.action); conditions.push(`s.action = $${params.length}`); }
  if (f.traiter === "1") conditions.push(`s.compte_id in (select compte_id from comptes_a_notifier)`);
  const where = conditions.join(" and ");
  const [{ n }] = await requete<{ n: number }>(`select count(*)::int as n from score_comptes s where ${where}`, params);
  const lignes = await requete<LigneCompte>(
    `select ${COLONNES_COMPTE} from score_comptes s where ${where} order by s.score desc, s.nom limit 50 offset ${(f.page - 1) * 50}`,
    params);
  const activites = await requete<{ activite: string; n: number }>(
    `select activite, count(*)::int as n from comptes where not exclu and activite is not null group by 1 order by 2 desc`);
  return { total: n, lignes, activites };
}

export async function ficheCompte(id: number) {
  const [compte] = await requete<LigneCompte & { site: string | null; url_linkedin: string | null; exclu: boolean; motif_exclusion: string | null; destinataire: string | null; a_transmettre: boolean }>(
    `select ${COLONNES_COMPTE}, s.site, s.url_linkedin, s.exclu, s.motif_exclusion, s.destinataire, s.a_transmettre
     from score_comptes s where s.compte_id = $1`, [id]);
  if (!compte) return null;
  const signaux = await requete<{ id: number; type_code: string; libelle: string; famille: string; points: number; expire_jours: number | null; survenu_le: string; source: string; detail: Record<string, unknown>; contact: string | null; contact_id: number | null; compte_contact: number | null; actif: boolean }>(
    `select s.id::int, s.type_code, t.libelle, t.famille, t.points, t.expire_jours, s.survenu_le, s.source, s.detail,
            nullif(trim(coalesce(c.prenom, '') || ' ' || coalesce(c.nom, '')), '') as contact, s.contact_id::int, c.compte_id::int as compte_contact,
            exists (select 1 from signaux_actifs a where a.id = s.id) as actif
     from signaux s join types_signal t on t.code = s.type_code left join contacts c on c.id = s.contact_id
     where s.compte_id = $1 order by (t.famille = 'adequation'), s.survenu_le desc`, [id]);
  const contacts = await requete<{ id: number; prenom: string | null; nom: string | null; poste: string | null; fonction: string; url_linkedin: string | null; email: string | null; telephone: string | null; origine: string; enrichi_le: string | null; email_statut: string | null }>(
    `select id::int, prenom, nom, poste, fonction, url_linkedin, email, telephone, origine::text, enrichi_le, email_statut
     from contacts where compte_id = $1 order by (fonction = 'autre'), poste`, [id]);
  return { compte, signaux, contacts };
}

export async function listeSignaux(f: { famille?: string; page: number }) {
  const params: unknown[] = [];
  let filtre = "t.famille in ('declencheur', 'intention')";
  if (f.famille === "declencheur" || f.famille === "intention") { params.push(f.famille); filtre = `t.famille = $1`; }
  filtre += " and not c.exclu";
  const [{ n }] = await requete<{ n: number }>(
    `select count(*)::int as n from signaux s join types_signal t on t.code = s.type_code join comptes c on c.id = s.compte_id where ${filtre}`, params);
  const lignes = await requete<{ id: number; survenu_le: string; source: string; detail: Record<string, unknown>; libelle: string; famille: string; points: number; compte_id: number; compte: string; palier: string; score: number; contact: string | null; contact_id: number | null; compte_contact: number | null; poste: string | null }>(
    `select s.id::int, s.survenu_le, s.source, s.detail, t.libelle, t.famille, t.points, c.id::int as compte_id, c.nom as compte,
            sc.palier, sc.score, nullif(trim(coalesce(ct.prenom, '') || ' ' || coalesce(ct.nom, '')), '') as contact,
            ct.id::int as contact_id, ct.compte_id::int as compte_contact, ct.poste
     from signaux s join types_signal t on t.code = s.type_code join comptes c on c.id = s.compte_id
     join score_comptes sc on sc.compte_id = c.id left join contacts ct on ct.id = s.contact_id
     where ${filtre} order by s.survenu_le desc limit 50 offset ${(f.page - 1) * 50}`, params);
  return { total: n, lignes };
}

export async function listeContacts(f: { fonction?: string; palier?: string; texte?: string; decideurs?: boolean; page: number }) {
  const conditions = ["not c.exclu"];
  const params: unknown[] = [];
  if (f.fonction) { params.push(f.fonction); conditions.push(`ct.fonction = $${params.length}`); }
  if (f.palier) { params.push(f.palier); conditions.push(`sc.palier = $${params.length}`); }
  if (f.texte) {
    params.push(`%${f.texte}%`);
    conditions.push(`(ct.nom ilike $${params.length} or ct.prenom ilike $${params.length} or ct.poste ilike $${params.length} or c.nom ilike $${params.length})`);
  }
  if (f.decideurs) conditions.push(`ct.poste ~* '(cmo|chief marketing|directeur.*marketing|directrice.*marketing|marketing director|head of marketing|directeur.*communication|directrice.*communication)'`);
  const where = conditions.join(" and ");
  const from = `from contacts ct join comptes c on c.id = ct.compte_id join score_comptes sc on sc.compte_id = c.id where ${where}`;
  const [{ n }] = await requete<{ n: number }>(`select count(*)::int as n ${from}`, params);
  const lignes = await requete<{ id: number; prenom: string | null; nom: string | null; poste: string | null; fonction: string; url_linkedin: string | null; email: boolean; compte_id: number; compte: string; palier: string; engagement: string; score: number }>(
    `select ct.id::int, ct.prenom, ct.nom, ct.poste, ct.fonction, ct.url_linkedin, (ct.email is not null) as email,
            c.id::int as compte_id, c.nom as compte, sc.palier, sc.engagement, sc.score
     ${from} order by sc.score desc, (ct.fonction = 'autre'), c.nom, ct.nom limit 50 offset ${(f.page - 1) * 50}`, params);
  return { total: n, lignes };
}

export async function grille() {
  const types = await requete<{ code: string; libelle: string; famille: string; points: number; expire_jours: number | null; n: number }>(
    `select t.code, t.libelle, t.famille, t.points, t.expire_jours,
            (select count(*)::int from signaux s where s.type_code = t.code) as n
     from types_signal t
     order by array_position(array['adequation', 'declencheur', 'intention', 'malus'], t.famille), t.points desc, t.libelle`);
  const parametres = await requete<{ cle: string; valeur: unknown; commentaire: string | null }>(
    `select cle, valeur, commentaire from parametres order by cle`);
  return { types, parametres };
}
