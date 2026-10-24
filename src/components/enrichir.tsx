"use client";

import { useState } from "react";
import { Loader2, Mail, Phone } from "lucide-react";

type Etat = { valeur: string | null; enCours: boolean; message: string | null };

// Bouton de recherche d'une coordonnée par FullEnrich : lance, puis interroge le résultat toutes les 4 secondes
// pendant deux minutes au plus. Affiche la valeur trouvée, ou la raison de l'échec.
export function Coordonnee({ contactId, champ, initiale, autorise }: { contactId: number; champ: "email" | "telephone"; initiale: string | null; autorise: boolean }) {
  const [etat, setEtat] = useState<Etat>({ valeur: initiale, enCours: false, message: null });
  const Icone = champ === "email" ? Mail : Phone;
  const libelle = champ === "email" ? "Chercher email" : "Chercher téléphone";

  const chercher = async () => {
    setEtat({ valeur: etat.valeur, enCours: true, message: null });
    try {
      const r = await fetch("/api/enrichir", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ contact_id: contactId, champ }) });
      const d = (await r.json()) as { enrichment_id?: string; erreur?: string };
      if (!d.enrichment_id) return setEtat({ valeur: etat.valeur, enCours: false, message: d.erreur ?? "Recherche refusée" });
      for (let i = 0; i < 30; i++) {
        await new Promise((ok) => setTimeout(ok, 4000));
        const g = (await (await fetch(`/api/enrichir?id=${d.enrichment_id}&contact=${contactId}&champ=${champ}`)).json()) as { statut?: string; valeur?: string | null; erreur?: string };
        if (g.erreur) return setEtat({ valeur: etat.valeur, enCours: false, message: g.erreur });
        if (g.statut === "terminé") return setEtat({ valeur: g.valeur ?? etat.valeur, enCours: false, message: g.valeur ? null : "Introuvable" });
      }
      setEtat({ valeur: etat.valeur, enCours: false, message: "Toujours en cours, rouvrez la fiche plus tard" });
    } catch {
      setEtat({ valeur: etat.valeur, enCours: false, message: "Problème de connexion" });
    }
  };

  if (etat.valeur) {
    return <span className="chiffres text-xs text-texte break-all">{etat.valeur}</span>;
  }
  return (
    <span className="flex flex-col items-start gap-1">
      <button type="button" onClick={chercher} disabled={!autorise || etat.enCours}
        title={autorise ? `${libelle} avec FullEnrich (${champ === "email" ? "1 crédit" : "10 crédits"})` : "Contact issu de la campagne ou du CRM : pas d'enrichissement tiers"}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-bord bg-surface-2 text-xs text-texte-2 hover:text-texte hover:border-accent/60 disabled:opacity-50 disabled:hover:border-bord">
        {etat.enCours ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icone className="w-3.5 h-3.5" />}
        {etat.enCours ? "Recherche…" : libelle}
      </button>
      {etat.message && <span className="text-[11px] text-texte-3">{etat.message}</span>}
    </span>
  );
}
