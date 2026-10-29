import { grille } from "@/lib/donnees";
import { FAMILLES, fNombre } from "@/lib/format";
import { Carte, Famille } from "@/components/ui";

export const metadata = { title: "Grille · Cockpit Hirondo ABX" };

// D'où vient chaque signal, pour la lecture de la grille.
const SOURCE: Record<string, string> = {
  taille_1000: "Base Pharow", taille_500: "Base Pharow", taille_250: "Base Pharow", secteur_jumeau: "Base Pharow",
  secteur_coeur: "Base Pharow", decideur_identifie: "Base Pharow, puis surveillance", moins_de_50: "Base Pharow", hors_france: "Base Pharow",
  membre_hirondo_en_mission: "CRM Notion Hirondo", contact_dormant_crm: "CRM Notion Hirondo",
  nouveau_decideur_marketing: "Apify, recherche mensuelle et presse", depart_decideur_marketing: "Apify, relecture mensuelle",
  champion_arrive: "Apify, relecture des profils engagés", recrutement_marketing_ops: "Apify, offres LinkedIn",
  visite_site: "Script du site (IPinfo Lite) et Leadfeeder", visite_page_cle: "Script du site (IPinfo Lite) et Leadfeeder", visites_repetees: "Script du site (IPinfo Lite) et Leadfeeder",
  commentaire_post: "ReachMCP, posts de Yannig relus chaque jour", engagement_post: "ReachMCP, posts de Yannig relus chaque jour", engagement_pairs: "Apify, engageurs des posts",
  visite_profil: "ReachMCP, avec LinkedIn Premium", reponse_linkedin: "ReachMCP, messages reçus", test_complete: "Formulaire du test", test_profil_outils: "Formulaire du test",
  formulaire_natif: "API LinkedIn Ads", video_50: "API LinkedIn Ads", entreprise_engagee_pub: "API LinkedIn Ads",
  email_clic: "Brevo", email_ouvert: "Brevo", email_reponse: "Brevo",
};

const SEUILS = [
  { cle: "plafond_adequation", nom: "Adéquation, sur" },
  { cle: "plafond_chaleur", nom: "Chaleur, sur" },
  { cle: "seuil_adequation_a", nom: "Palier A" },
  { cle: "seuil_adequation_b", nom: "Palier B" },
  { cle: "seuil_chaud", nom: "Chaud" },
  { cle: "seuil_tiede", nom: "Tiède" },
  { cle: "seuil_execution", nom: "Exécution ABM" },
];

export default async function Grille() {
  const { types, parametres } = await grille();
  const familles = ["adequation", "declencheur", "intention", "malus"];
  const p = new Map(parametres.map((x) => [x.cle, x.valeur]));
  // Un lead direct porte le score du compte à 100, quels que soient ses points.
  const leadDirect = new Set((p.get("types_lead_direct") as string[] | undefined) ?? []);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-titre text-4xl">Grille</h1>
        <span className="text-xs text-texte-3">Lecture seule · modifiée dans la configuration de la machine</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        {SEUILS.map((s) => (
          <div key={s.cle} className="rounded-xl border border-bord bg-surface px-4 py-3">
            <p className="text-xs text-texte-2">{s.nom}</p>
            <p className="chiffres text-2xl mt-1">{String(p.get(s.cle) ?? "n.c.")}</p>
          </div>
        ))}
      </div>
      {familles.map((f) => {
        const lignes = types.filter((t) => t.famille === f);
        return (
          <Carte key={f}>
            <div className="flex items-center gap-3 px-5 pt-4">
              <Famille famille={f} />
              <span className="text-xs text-texte-2">{lignes.length} règles</span>
            </div>
            <div className="overflow-x-auto mt-2">
              <table className="w-full text-sm min-w-[720px]">
                <thead>
                  <tr className="text-left text-xs text-texte-3 border-b border-bord">
                    <th className="font-normal px-5 py-2">Règle</th>
                    <th className="font-normal px-3 py-2 text-right">Points</th>
                    <th className="font-normal px-3 py-2">Durée</th>
                    <th className="font-normal px-3 py-2">Source</th>
                    <th className="font-normal px-5 py-2 text-right">Signaux en base</th>
                  </tr>
                </thead>
                <tbody>
                  {lignes.map((t) => (
                    <tr key={t.code} className="border-b border-bord/60">
                      <td className="px-5 py-2.5">
                        <p className="first-letter:uppercase">{t.libelle}</p>
                        <p className="text-xs text-texte-3 chiffres">{t.code}</p>
                      </td>
                      <td className="px-3 py-2.5 text-right chiffres">
                        {leadDirect.has(t.code) ? <span className="font-semibold text-accent-fort" title="Lead direct : à contacter tout de suite">score 100</span> : t.points > 0 ? `+${t.points}` : t.points}
                      </td>
                      <td className="px-3 py-2.5 text-texte-2">{t.expire_jours ? `${t.expire_jours} jours` : "permanente"}</td>
                      <td className="px-3 py-2.5 text-texte-2">{SOURCE[t.code] ?? "n.c."}</td>
                      <td className="px-5 py-2.5 text-right chiffres">{fNombre(t.n)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="px-5 py-3 text-xs text-texte-3">{FAMILLES[f]} · {f === "adequation" ? "donne le palier A, B ou C" : f === "malus" ? "compté avec l'adéquation" : "compte dans la chaleur tant qu'il n'a pas expiré"}</p>
          </Carte>
        );
      })}
    </div>
  );
}
