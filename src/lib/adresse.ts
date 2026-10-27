// Adresse publique du site, pour les retours des services tiers (Apify, FullEnrich). La tâche planifiée de Vercel
// appelle l'adresse propre au déploiement, protégée par une connexion Vercel : un webhook envoyé là est redirigé
// et perdu (relevés des engageurs du 25/10/2026 jamais revenus). VERCEL_PROJECT_PRODUCTION_URL est posée par Vercel.
export function adressePublique(request: Request): string {
  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return prod ? `https://${prod}` : new URL(request.url).origin;
}
