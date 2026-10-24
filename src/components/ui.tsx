import Link from "next/link";
import clsx from "clsx";
import { ENGAGEMENTS, FAMILLES } from "@/lib/format";

export function Palier({ palier }: { palier: string }) {
  return (
    <span
      className={clsx(
        "inline-grid place-items-center w-6 h-6 rounded-md text-xs font-semibold chiffres",
        palier === "A" && "bg-accent text-white",
        palier === "B" && "bg-accent-pale text-accent-fort border border-accent/40",
        palier === "C" && "bg-surface-3 text-texte-2 border border-bord",
      )}
      title={`Palier d'adéquation ${palier}`}
    >
      {palier}
    </span>
  );
}

export function Engagement({ engagement }: { engagement: string }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs border",
        engagement === "chaud" && "bg-chaud-pale text-chaud border-chaud/40",
        engagement === "tiede" && "bg-surface-3 text-tiede border-tiede/40",
        engagement === "froid" && "bg-froid-pale text-froid border-froid/30",
      )}
    >
      <span className={clsx("w-1.5 h-1.5 rounded-full", engagement === "chaud" ? "bg-chaud" : engagement === "tiede" ? "bg-tiede" : "bg-froid")} />
      {ENGAGEMENTS[engagement] ?? engagement}
    </span>
  );
}

export function Action({ action }: { action: string }) {
  const forte = action === "Transmettre" || action === "Alerte nouveau décideur";
  return (
    <span className={clsx("inline-block px-2 py-0.5 rounded-md text-xs whitespace-nowrap", forte ? "bg-accent text-white font-semibold" : "bg-surface-3 text-texte-2")}>
      {action}
    </span>
  );
}

export function Famille({ famille }: { famille: string }) {
  return (
    <span
      className={clsx(
        "inline-block px-2 py-0.5 rounded-md text-[11px] uppercase tracking-wide border",
        famille === "adequation" && "text-froid border-froid/40",
        famille === "declencheur" && "text-accent-fort border-accent/50 bg-accent-pale",
        famille === "intention" && "text-white border-accent bg-accent",
        famille === "malus" && "text-alerte border-alerte/40 bg-alerte-pale",
      )}
    >
      {FAMILLES[famille] ?? famille}
    </span>
  );
}

/** Barre de score sur 100 : adéquation (gris, 40 au plus) puis chaleur (bleu, 60 au plus), déjà plafonnées par la base.
 *  Un lead direct (test complété, formulaire LinkedIn) vaut 100 : la partie bleue comble alors la barre. */
export function BarreScore({ adequation, chaleur, score }: { adequation: number; chaleur: number; score?: number }) {
  const echelle = 100;
  const a = Math.max(0, Math.min(adequation, 40));
  const total = Math.max(0, Math.min(score ?? a + Math.min(chaleur, 60), echelle));
  const c = Math.max(0, total - a);
  return (
    <div className="flex items-center gap-2 min-w-[150px]">
      <span className="chiffres w-8 text-right font-medium">{total}</span>
      <div className="flex-1 h-1.5 rounded-full bg-surface-3 overflow-hidden flex" aria-hidden>
        <span style={{ width: `${(a / echelle) * 100}%` }} className="bg-froid" />
        <span style={{ width: `${(c / echelle) * 100}%` }} className="bg-accent" />
      </div>
    </div>
  );
}

export function Carte({ children, className }: { children: React.ReactNode; className?: string }) {
  return <section className={clsx("bg-surface border border-bord rounded-xl", className)}>{children}</section>;
}

export function TitreSection({ titre, aide, droite }: { titre: string; aide?: string; droite?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 pt-4">
      <div>
        <h2 className="text-[15px] font-semibold">{titre}</h2>
        {aide && <p className="text-xs text-texte-2 mt-0.5 max-w-[70ch]">{aide}</p>}
      </div>
      {droite}
    </div>
  );
}

export function Pagination({ page, total, base, params }: { page: number; total: number; base: string; params: Record<string, string> }) {
  const pages = Math.max(1, Math.ceil(total / 50));
  const lien = (p: number) => {
    const sp = new URLSearchParams({ ...params, page: String(p) });
    for (const [k, v] of [...sp.entries()]) if (!v) sp.delete(k);
    return `${base}?${sp.toString()}`;
  };
  const debut = total ? (page - 1) * 50 + 1 : 0;
  const fin = Math.min(page * 50, total);
  return (
    <div className="flex items-center justify-between px-5 py-3 text-xs text-texte-2">
      <span className="chiffres">
        {debut} à {fin} sur {total.toLocaleString("fr-FR")}
      </span>
      <div className="flex gap-2">
        {page > 1 ? <Link href={lien(page - 1)} className="px-3 py-1.5 rounded-md bg-surface-3 hover:text-texte">Précédent</Link> : <span className="px-3 py-1.5 rounded-md bg-surface-2 opacity-50">Précédent</span>}
        {page < pages ? <Link href={lien(page + 1)} className="px-3 py-1.5 rounded-md bg-accent text-white font-semibold">Suivant</Link> : <span className="px-3 py-1.5 rounded-md bg-surface-2 opacity-50">Suivant</span>}
      </div>
    </div>
  );
}

export function Vide({ texte }: { texte: string }) {
  return <p className="px-5 py-10 text-center text-sm text-texte-2">{texte}</p>;
}
