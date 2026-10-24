// Accès par mot de passe (variable d'environnement DASHBOARD_PASSWORD).
// Le cookie de session contient une empreinte SHA-256 du mot de passe, jamais le mot de passe ;
// changer le mot de passe invalide toutes les sessions.
export const SESSION_COOKIE = "pm_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 jours

export async function sessionToken(password: string): Promise<string> {
  const data = new TextEncoder().encode(`${password}|poc-machine-abx`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
