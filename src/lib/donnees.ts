import { requete } from "@/lib/db";
import { OPERATEURS } from "@/lib/visites";

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
  { cle: "engageurs", nom: "Engageurs des posts LinkedIn", detail: "ReachMCP chaque jour pour les posts de Yannig, Apify pour les posts des pairs", nature: "Machine", types: ["engagement_post", "commentaire_post", "engagement_pairs"], evenements: "apify" },
  { cle: "site", nom: "Visites de hirondo.co", detail: "script maison et IPinfo Lite, Leadfeeder et Snitcher relevés chaque jour", nature: "Machine", types: ["visite_site", "visite_page_cle", "visites_repetees"], evenements: "site" },
  { cle: "offres", nom: "Offres d'emploi marketing ops", detail: "Apify, relevé hebdomadaire", nature: "Machine", types: ["recrutement_marketing_ops"], evenements: null },
  { cle: "test", nom: "Test de maturité ABM", detail: "formulaire, webhook", nature: "Webhook", types: ["test_complete", "test_profil_outils"], evenements: "test" },
  { cle: "linkedin", nom: "LinkedIn Ads", detail: "formulaires, vidéo, entreprises engagées", nature: "API", types: ["formulaire_natif", "video_50", "entreprise_engagee_pub"], evenements: "linkedin" },
  { cle: "brevo", nom: "Emails Brevo", detail: "ouvertures, clics, réponses", nature: "Webhook", types: ["email_ouvert", "email_clic", "email_reponse"], evenements: "brevo" },
  { cle: "reachmcp", nom: "ReachMCP", detail: "messages reçus sur le profil de Yannig ; visites du profil avec LinkedIn Premium seulement", nature: "Webhook", types: ["visite_profil", "reponse_linkedin"], evenements: "reachmcp" },
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
  const [compte] = await requete<LigneCompte & { site: string | null; url_linkedin: string | null; exclu: boolean; motif_exclusion: string | null; destinataire: string | null; a_transmettre: boolean; lead_direct: boolean; pipeline_hirondo: string | null }>(
    `select ${COLONNES_COMPTE}, s.site, s.url_linkedin, s.exclu, s.motif_exclusion, s.destinataire, s.a_transmettre, s.lead_direct, s.pipeline_hirondo
     from score_comptes s where s.compte_id = $1`, [id]);
  if (!compte) return null;
  const signaux = await requete<{ id: number; type_code: string; libelle: string; famille: string; points: number; expire_jours: number | null; survenu_le: string; source: string; detail: Record<string, unknown>; contact: string | null; contact_id: number | null; compte_contact: number | null; actif: boolean }>(
    `select s.id::int, s.type_code, t.libelle, t.famille, t.points, t.expire_jours, s.survenu_le, s.source, s.detail,
            nullif(trim(coalesce(c.prenom, '') || ' ' || coalesce(c.nom, '')), '') as contact, s.contact_id::int, c.compte_id::int as compte_contact,
            exists (select 1 from signaux_actifs a where a.id = s.id) as actif
     from signaux s join types_signal t on t.code = s.type_code left join contacts c on c.id = s.contact_id
     where s.compte_id = $1 order by (t.famille = 'adequation'), s.survenu_le desc`, [id]);
  const contacts = await requete<{ id: number; prenom: string | null; nom: string | null; poste: string | null; fonction: string; url_linkedin: string | null; email: string | null; telephone: string | null; origine: string; enrichi_le: string | null; email_statut: string | null; email_verif: string | null; email_verif_detail: string | null; email_source: string | null }>(
    `select id::int, prenom, nom, poste, fonction, url_linkedin, email, telephone, origine::text, enrichi_le, email_statut,
            email_verif, email_verif_detail, email_source
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
  const lignes = await requete<{ id: number; prenom: string | null; nom: string | null; poste: string | null; fonction: string; url_linkedin: string | null; email: boolean; email_verif: string | null; email_verif_detail: string | null; compte_id: number; compte: string; palier: string; engagement: string; score: number }>(
    `select ct.id::int, ct.prenom, ct.nom, ct.poste, ct.fonction, ct.url_linkedin, (ct.email is not null) as email,
            ct.email_verif, ct.email_verif_detail,
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

export type Variante = { lettre: string; skill: string; angle: string | null; part: number; objet: string | null; corps: string | null };
export type Etape = { numero: number; jour: number; canal: string; action: string; libelle: string; condition: string | null; outil: string | null; variantes: Variante[] };
export type Sequence = {
  code: string; nom: string; declencheur: string; statut: string; objectif: string | null; sortie: string | null; garde_fous: string | null;
  etapes: Etape[]; concernes: { contacts: number; email_valide: number; linkedin: number };
};

/** Séquences de la configuration, avec leurs étapes et variantes, et les contacts qu'elles toucheraient aujourd'hui. */
export async function sequences(): Promise<Sequence[]> {
  const seqs = await requete<Omit<Sequence, "etapes" | "concernes"> & { type_signal: string | null }>(
    `select code, nom, declencheur, type_signal, statut, objectif, sortie, garde_fous from sequences order by ordre, nom`);
  const etapes = await requete<Omit<Etape, "variantes"> & { sequence_code: string }>(
    `select sequence_code, numero, jour, canal, action, libelle, condition, outil from sequence_etapes order by sequence_code, numero`);
  const variantes = await requete<Variante & { sequence_code: string; numero: number }>(
    `select sequence_code, numero, lettre, skill, angle, part, objet, corps from sequence_variantes order by sequence_code, numero, lettre`);
  return Promise.all(seqs.map(async (s) => {
    // Contacts portés par un signal actif du déclencheur, comptes exclus à part.
    const [c] = s.type_signal ? await requete<Sequence["concernes"]>(
      `select count(distinct ct.id)::int as contacts,
              count(distinct ct.id) filter (where ct.email_verif = 'valid')::int as email_valide,
              count(distinct ct.id) filter (where ct.url_linkedin like '%linkedin.com/in/%')::int as linkedin
       from signaux sg join types_signal t on t.code = sg.type_code join contacts ct on ct.id = sg.contact_id
       join comptes co on co.id = ct.compte_id
       where sg.type_code = $1 and not co.exclu and ct.compte_id = sg.compte_id
         and (t.expire_jours is null or sg.survenu_le >= now() - make_interval(days => t.expire_jours))`, [s.type_signal]) : [];
    return {
      ...s,
      etapes: etapes.filter((e) => e.sequence_code === s.code).map((e) => ({
        ...e, variantes: variantes.filter((v) => v.sequence_code === s.code && v.numero === e.numero),
      })),
      concernes: c ?? { contacts: 0, email_valide: 0, linkedin: 0 },
    };
  }));
}

// Visites du site suivi (script /t.js) : le réseau d'origine de chaque visite, lu par IPinfo Lite, dit si elle vient
// d'une entreprise (son propre réseau), d'un opérateur ou d'un hébergeur (box, mobile, VPN : personne n'est reconnu),
// ou d'un réseau inconnu. Sert à juger ce que vaut l'identification par adresse IP.
export type NatureReseau = "entreprise" | "operateur" | "inconnu";

export async function visitesSite(jours: number) {
  const base = `with v as (
      select e.recu_le, e.charge->>'visiteur' as visiteur, e.charge->>'page' as page, e.charge->>'referent' as referent,
             e.charge->'reseau'->>'nom' as reseau, e.charge->'reseau'->>'domaine' as domaine, e.charge->'reseau'->>'pays' as pays,
             (e.charge->>'compte_id')::bigint as compte_id, e.charge->>'rapprochement' as par,
             case when e.charge->'reseau'->>'nom' is null then 'inconnu'
                  when e.charge->'reseau'->>'nom' ~* $2 then 'operateur' else 'entreprise' end as nature
      from evenements_bruts e where e.source = 'site' and e.recu_le >= now() - make_interval(days => $1))`;
  const params = [jours, OPERATEURS.source];
  const [chiffres] = await requete<Record<string, number | string | null>>(`${base}
    select count(*)::int as pages_vues, count(distinct visiteur)::int as visiteurs,
           (count(distinct visiteur) filter (where nature = 'entreprise'))::int as visiteurs_entreprise,
           (count(distinct coalesce(domaine, reseau)) filter (where nature = 'entreprise'))::int as entreprises,
           count(distinct compte_id)::int as comptes,
           (count(distinct visiteur) filter (where compte_id is not null))::int as visiteurs_comptes,
           (count(distinct visiteur) filter (where nature = 'operateur'))::int as visiteurs_operateur,
           (count(distinct visiteur) filter (where nature = 'inconnu'))::int as visiteurs_inconnus,
           max(recu_le) as derniere
    from v`, params);
  const entreprises = await requete<{ reseau: string; domaine: string | null; pays: string | null; pages_vues: number; visiteurs: number;
    derniere: string; pages: string[]; compte_id: number | null; par: string | null; compte: string | null; palier: string | null }>(`${base}
    select x.*, c.nom as compte, s.palier from (
      select reseau, domaine, max(pays) as pays, count(*)::int as pages_vues, count(distinct visiteur)::int as visiteurs,
             max(recu_le) as derniere, (array_agg(distinct page))[1:4] as pages, max(compte_id)::int as compte_id, max(par) as par
      from v where nature = 'entreprise' group by reseau, domaine) x
    left join comptes c on c.id = x.compte_id
    left join score_comptes s on s.compte_id = x.compte_id
    order by (x.compte_id is null), x.visiteurs desc, x.pages_vues desc limit 100`, params);
  const autres = await requete<{ reseau: string; nature: NatureReseau; visiteurs: number; pages_vues: number }>(`${base}
    select coalesce(reseau, 'Réseau non trouvé') as reseau, nature, count(distinct visiteur)::int as visiteurs, count(*)::int as pages_vues
    from v where nature <> 'entreprise' group by 1, 2 order by 3 desc, 4 desc limit 12`, params);
  const recentes = await requete<{ recu_le: string; page: string; referent: string | null; reseau: string | null; domaine: string | null;
    nature: NatureReseau; compte_id: number | null; compte: string | null }>(`${base}
    select v.recu_le, v.page, v.referent, v.reseau, v.domaine, v.nature, v.compte_id::int as compte_id, c.nom as compte
    from v left join comptes c on c.id = v.compte_id order by v.recu_le desc limit 50`, params);
  return { chiffres, entreprises, autres, recentes };
}

// Leadfeeder et Snitcher, relevés chaque jour, face à IPinfo Lite sur la même période. Une entreprise est « vue par
// IPinfo » quand IPinfo a rattaché une visite au même compte, ou a vu un réseau au même domaine.
export const OUTILS = ["leadfeeder", "snitcher"] as const;

export async function visitesOutils(jours: number) {
  const base = `with l as (select * from visites_outils where debut >= now() - make_interval(days => $1)),
    ip as (select distinct (e.charge->>'compte_id')::bigint as compte_id, lower(e.charge->'reseau'->>'domaine') as domaine
           from evenements_bruts e where e.source = 'site' and e.recu_le >= now() - make_interval(days => $1)
             and e.charge->'reseau'->>'nom' is not null and not (e.charge->'reseau'->>'nom' ~* $2))`;
  const params = [jours, OPERATEURS.source];
  const parOutil = await requete<{ outil: string; visites: number; reconnues: number; entreprises: number; comptes: number;
    comptes_ipinfo_aussi: number; premiere: string | null; releve: string | null }>(`${base}
    select o.outil, count(l.id)::int as visites, (count(l.id) filter (where l.entreprise is not null))::int as reconnues,
           count(distinct coalesce(l.domaine, l.entreprise))::int as entreprises, count(distinct l.compte_id)::int as comptes,
           (count(distinct l.compte_id) filter (where l.compte_id in (select compte_id from ip)))::int as comptes_ipinfo_aussi,
           (select min(debut) from visites_outils v where v.outil = o.outil) as premiere,
           (select max(lu_le) from visites_outils v where v.outil = o.outil) as releve
    from unnest($3::text[]) as o(outil) left join l on l.outil = o.outil group by o.outil`, [...params, OUTILS]);
  const [ip] = await requete<{ comptes: number }>(`${base} select count(distinct compte_id)::int as comptes from ip`, params);
  const entreprises = await requete<{ entreprise: string; domaine: string | null; pays: string | null; effectif: number | null;
    leadfeeder: number; snitcher: number; derniere: string; pages: string[] | null; compte_id: number | null; par: string | null;
    compte: string | null; palier: string | null; vue_ipinfo: boolean }>(`${base}
    select x.*, c.nom as compte, s.palier,
           exists (select 1 from ip where (x.compte_id is not null and ip.compte_id = x.compte_id)
                                       or (x.domaine is not null and ip.domaine = x.domaine)) as vue_ipinfo
    from (select max(l.entreprise) as entreprise, l.domaine, max(l.pays) as pays, max(l.effectif) as effectif,
                 (count(distinct l.id) filter (where l.outil = 'leadfeeder'))::int as leadfeeder,
                 (count(distinct l.id) filter (where l.outil = 'snitcher'))::int as snitcher,
                 max(l.debut) as derniere, (array_agg(distinct p.page) filter (where p.page is not null))[1:4] as pages,
                 max(l.compte_id)::int as compte_id, max(l.rapprochement) as par
          from l left join lateral unnest(l.pages) as p(page) on true
          where l.entreprise is not null
          group by coalesce(l.domaine, lower(l.entreprise)), l.domaine) x
    left join comptes c on c.id = x.compte_id
    left join score_comptes s on s.compte_id = x.compte_id
    order by (x.compte_id is null), (x.leadfeeder > 0 and x.snitcher > 0) desc, x.leadfeeder + x.snitcher desc, x.derniere desc
    limit 100`, params);
  return { parOutil, comptesIpinfo: ip?.comptes ?? 0, entreprises };
}
