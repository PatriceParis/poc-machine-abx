const dateCourte = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", year: "numeric", timeZone: "Europe/Paris" });
const dateHeure = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });
const jourLong = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Paris" });

export const fDate = (d: string | Date | null | undefined) => (d ? dateCourte.format(new Date(d)) : "Aucun");
export const fDateHeure = (d: string | Date | null | undefined) => (d ? dateHeure.format(new Date(d)) : "Aucune");
export const fJour = (d: Date) => jourLong.format(d);
export const fNombre = (n: number | null | undefined) => (n == null ? "0" : n.toLocaleString("fr-FR"));

export const FONCTIONS: Record<string, string> = {
  marketing: "Marketing",
  growth: "Growth et acquisition",
  direction_generale: "Direction générale",
  autre: "Autre fonction",
};

export const FAMILLES: Record<string, string> = {
  adequation: "Adéquation",
  declencheur: "Déclencheur",
  intention: "Intention",
  malus: "Malus",
};

export const ENGAGEMENTS: Record<string, string> = { chaud: "Chaud", tiede: "Tiède", froid: "Froid" };

const DECIDEUR = /\b(cmo|chief marketing|directeur.*marketing|directrice.*marketing|marketing director|director of marketing|head of marketing|vp marketing|directeur.*communication|directrice.*communication|chief brand|chief growth|head of growth)\b/i;
export const estDecideur = (poste: string | null) => DECIDEUR.test(poste || "");

export function q(params: Record<string, string | string[] | undefined>, cle: string): string {
  const v = params[cle];
  return Array.isArray(v) ? v[0] || "" : v || "";
}
