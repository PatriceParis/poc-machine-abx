import { neon } from "@neondatabase/serverless";

// Lecture et écriture côté serveur seulement : l'adresse de la base ne quitte jamais le serveur.
let client: ReturnType<typeof neon> | null = null;

export function base() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL absente");
  if (!client) client = neon(url);
  return client;
}

export async function requete<T = Record<string, unknown>>(texte: string, params: unknown[] = []): Promise<T[]> {
  return (await base().query(texte, params)) as T[];
}

export const baseConfiguree = () => Boolean(process.env.DATABASE_URL);
