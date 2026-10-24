// Identification des entreprises qui visitent le site, sans outil payant : l'adresse IP donne le réseau
// d'origine (IPinfo Lite), et les grands comptes naviguent depuis leur propre réseau, dont le nom
// ou le domaine correspond à un compte de la base. L'adresse IP n'est jamais conservée, seule son empreinte.

export type Reseau = { asn: string | null; nom: string | null; domaine: string | null; pays: string | null };

export async function reseauDeIp(ip: string): Promise<Reseau | null> {
  const jeton = process.env.IPINFO_TOKEN;
  try {
    if (jeton) {
      const r = await fetch(`https://api.ipinfo.io/lite/${encodeURIComponent(ip)}?token=${encodeURIComponent(jeton)}`, { cache: "no-store" });
      if (!r.ok) return null;
      const d = (await r.json()) as { asn?: string; as_name?: string; as_domain?: string; country_code?: string };
      return { asn: d.asn ?? null, nom: d.as_name ?? null, domaine: d.as_domain ?? null, pays: d.country_code ?? null };
    }
    // Sans jeton : API publique, limitée en volume, qui rend « AS1234 Nom du réseau ».
    const r = await fetch(`https://ipinfo.io/${encodeURIComponent(ip)}/json`, { cache: "no-store" });
    if (!r.ok) return null;
    const d = (await r.json()) as { org?: string; country?: string; bogon?: boolean };
    if (d.bogon || !d.org) return null;
    const m = /^(AS\d+)\s+(.*)$/.exec(d.org);
    return { asn: m ? m[1] : null, nom: m ? m[2] : d.org, domaine: null, pays: d.country ?? null };
  } catch {
    return null;
  }
}

export async function empreinteIp(ip: string): Promise<string> {
  const sel = process.env.WEBHOOK_SECRET || "machine";
  const data = new TextEncoder().encode(`${sel}|${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const SANS_SENS = new Set(["com", "fr", "net", "org", "eu", "io", "co", "www", "group", "groupe", "the", "sa", "sas", "se",
  "ltd", "inc", "gmbh", "ag", "as", "france", "services", "service", "network", "networks", "telecom", "online", "cloud"]);

export function normaliser(t: string): string {
  return t.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function libellesDomaine(domaine: string | null): string[] {
  if (!domaine) return [];
  return normaliser(domaine.replace(/^https?:\/\//, "")).split(" ").filter((l) => l.length >= 4 && !SANS_SENS.has(l));
}

function motsSignifiants(t: string): string[] {
  return normaliser(t).split(" ").filter((m) => m.length >= 3 && !SANS_SENS.has(m));
}

// Réseaux d'opérateurs et d'hébergeurs : une visite qui en vient ne désigne aucune entreprise.
const OPERATEURS = /orange|sfr|free sas|proxad|bouygues|numericable|completel|ovh|amazon|google|microsoft|cloudflare|akamai|digitalocean|hetzner|scaleway|online s\.a\.s|iliad|vodafone|telefonica|deutsche telekom|swisscom|proximus|zscaler|netskope|apple|m247|leaseweb|choopa|vultr|linode/i;

export type CompteCandidat = { id: number; nom: string; domaine: string | null; effectif: number | null };

/** Rapproche un réseau d'un compte : domaine du réseau d'abord, puis nom. À égalité, le plus gros compte. */
export function rapprocher(reseau: Reseau, comptes: CompteCandidat[]): { compte: CompteCandidat; par: string } | null {
  if (!reseau.nom && !reseau.domaine) return null;
  if (reseau.nom && OPERATEURS.test(reseau.nom)) return null;
  const parTaille = (a: CompteCandidat, b: CompteCandidat) => (b.effectif ?? 0) - (a.effectif ?? 0);

  const libRes = libellesDomaine(reseau.domaine);
  if (libRes.length) {
    const parDomaine = comptes.filter((c) => libellesDomaine(c.domaine).some((l) => libRes.includes(l))).sort(parTaille);
    if (parDomaine.length) return { compte: parDomaine[0], par: "domaine du réseau" };
  }
  if (reseau.nom) {
    const motsRes = motsSignifiants(reseau.nom);
    const nomRes = motsRes.join(" ");
    const parNom = comptes
      .filter((c) => {
        const motsCompte = motsSignifiants(c.nom);
        if (!motsCompte.length) return false;
        const nomCompte = motsCompte.join(" ");
        // Le nom complet du compte figure dans celui du réseau, ou le libellé du site du compte y figure.
        return (nomCompte.length >= 5 && ` ${nomRes} `.includes(` ${nomCompte} `))
          || libellesDomaine(c.domaine).some((l) => motsRes.includes(l));
      })
      .sort(parTaille);
    if (parNom.length) return { compte: parNom[0], par: "nom du réseau" };
  }
  return null;
}

export const PAGES_CLES = /casestudy\/allianz-trade|etude-de-cas|abm|account-based/i;
