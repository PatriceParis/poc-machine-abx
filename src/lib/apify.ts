// Lancement asynchrone des acteurs Apify : chaque run prévient le tableau de bord à la fin par un webhook,
// qui lit alors le jeu de données. Aucune attente dans la fonction qui lance. Plafond de dépense à chaque run.
const API = "https://api.apify.com/v2";

export const ACTEURS = {
  postes: "harvestapi~linkedin-profile-search",
  decideurs: "harvestapi~linkedin-profile-scraper",
  reactions: "harvestapi~linkedin-post-reactions",
  commentaires: "harvestapi~linkedin-post-comments",
  manquants: "harvestapi~linkedin-company-employees",
} as const;

function jeton() {
  const t = process.env.APIFY_TOKEN;
  if (!t) throw new Error("APIFY_TOKEN absent");
  return t;
}

export async function lancer(acteur: string, entree: unknown, retour: string, plafondUsd: number): Promise<string> {
  const webhooks = Buffer.from(JSON.stringify([{
    eventTypes: ["ACTOR.RUN.SUCCEEDED", "ACTOR.RUN.FAILED", "ACTOR.RUN.TIMED_OUT", "ACTOR.RUN.ABORTED"],
    requestUrl: retour,
  }])).toString("base64");
  const r = await fetch(`${API}/acts/${acteur}/runs?maxTotalChargeUsd=${plafondUsd}&webhooks=${encodeURIComponent(webhooks)}`, {
    method: "POST",
    headers: { authorization: `Bearer ${jeton()}`, "content-type": "application/json" },
    body: JSON.stringify(entree),
  });
  // Jamais le jeton ni l'adresse de retour (qui porte le secret) dans un message d'erreur.
  if (!r.ok) throw new Error(`Apify ${r.status} au lancement de ${acteur}`);
  const d = (await r.json()) as { data: { id: string } };
  return d.data.id;
}

export async function lireJeu(idJeu: string): Promise<Record<string, unknown>[]> {
  const r = await fetch(`${API}/datasets/${encodeURIComponent(idJeu)}/items?clean=true&format=json`, {
    headers: { authorization: `Bearer ${jeton()}` },
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`Apify ${r.status} à la lecture du jeu`);
  return (await r.json()) as Record<string, unknown>[];
}
