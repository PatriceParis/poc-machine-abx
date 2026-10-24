"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Mail, Phone, Users } from "lucide-react";

type Resultat = { contact_id: number; champ: string; valeur: string | null };

// Interroge le résultat toutes les 5 secondes pendant trois minutes au plus. Le webhook de FullEnrich écrit de
// toute façon le résultat en base : quitter la page n'empêche rien.
async function attendre(id: string): Promise<Resultat[] | null> {
  for (let i = 0; i < 36; i++) {
    await new Promise((ok) => setTimeout(ok, 5000));
    const g = (await (await fetch(`/api/enrichir?id=${id}`)).json()) as { statut?: string; resultats?: Resultat[] };
    if (g.statut === "terminé") return g.resultats ?? [];
  }
  return null;
}

export function Coordonnee({ contactId, champ, initiale, autorise }: { contactId: number; champ: "email" | "telephone"; initiale: string | null; autorise: boolean }) {
  const [valeur, setValeur] = useState(initiale);
  const [enCours, setEnCours] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const Icone = champ === "email" ? Mail : Phone;
  const libelle = champ === "email" ? "Chercher email" : "Chercher téléphone";

  const chercher = async () => {
    setEnCours(true);
    setMessage(null);
    try {
      const r = await fetch("/api/enrichir", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ contact_id: contactId, champ }) });
      const d = (await r.json()) as { enrichment_id?: string; erreur?: string };
      if (!d.enrichment_id) return setMessage(d.erreur ?? "Recherche refusée");
      setMessage("30 à 90 secondes, vous pouvez quitter la page");
      const resultats = await attendre(d.enrichment_id);
      const trouve = resultats?.find((x) => x.contact_id === contactId)?.valeur ?? null;
      if (resultats === null) setMessage("Toujours en cours, le résultat s'affichera à la prochaine visite");
      else if (trouve) { setValeur(trouve); setMessage(null); }
      else setMessage("Introuvable");
    } catch {
      setMessage("Problème de connexion");
    } finally {
      setEnCours(false);
    }
  };

  if (valeur) return <span className="chiffres text-xs text-texte break-all">{valeur}</span>;
  return (
    <span className="flex flex-col items-start gap-1">
      <button type="button" onClick={chercher} disabled={!autorise || enCours}
        title={autorise ? `${libelle} avec FullEnrich (${champ === "email" ? "1 crédit" : "10 crédits"} si trouvé)` : "Contact issu de la campagne ou du CRM : pas d'enrichissement tiers"}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-bord bg-surface-2 text-xs text-texte-2 hover:text-texte hover:border-accent/60 disabled:opacity-50 disabled:hover:border-bord">
        {enCours ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icone className="w-3.5 h-3.5" />}
        {enCours ? "Recherche…" : libelle}
      </button>
      {message && <span className="text-[11px] text-texte-3">{message}</span>}
    </span>
  );
}

/** Lance d'un coup la recherche des emails de tous les décideurs marketing du compte qui n'en ont pas. */
export function EmailsDecideurs({ compteId, nombre }: { compteId: number; nombre: number }) {
  const router = useRouter();
  const [etat, setEtat] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  if (!nombre) return null;

  const lancer = async () => {
    setEnCours(true);
    try {
      const r = await fetch("/api/enrichir", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ compte_id: compteId, champ: "email" }) });
      const d = (await r.json()) as { enrichment_id?: string; n?: number; erreur?: string };
      if (!d.enrichment_id) return setEtat(d.erreur ?? "Recherche refusée");
      setEtat(`${d.n} recherches lancées en parallèle, une à deux minutes`);
      const resultats = await attendre(d.enrichment_id);
      if (resultats === null) setEtat("Toujours en cours, les emails s'afficheront à la prochaine visite");
      else { setEtat(`${resultats.filter((x) => x.valeur).length} emails trouvés sur ${resultats.length}`); router.refresh(); }
    } catch {
      setEtat("Problème de connexion");
    } finally {
      setEnCours(false);
    }
  };

  return (
    <span className="flex items-center gap-3">
      {etat && <span className="text-xs text-texte-3">{etat}</span>}
      <button type="button" onClick={lancer} disabled={enCours}
        title={`Jusqu'à ${nombre} crédits FullEnrich, débités seulement pour les emails trouvés`}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent text-white text-xs font-medium hover:bg-accent-fort disabled:opacity-60">
        {enCours ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Users className="w-3.5 h-3.5" />}
        Chercher les emails des décideurs ({nombre})
      </button>
    </span>
  );
}
