import Link from "next/link";
import clsx from "clsx";
import { ENGAGEMENTS, FAMILLES } from "@/lib/format";

export function Palier({ palier }: { palier: string }) {
  return (
    <span
      className={clsx(
        "inline-grid place-items-center w-6 h-6 rounded-md text-xs font-semibold chiffres",
        palier === "A" && "bg-or text-fond",
        palier === "B" && "bg-or-pale text-or-fort border border-or/40",
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
        engagement === "tiede" && "bg-or-pale text-or-fort border-or/40",
        engagement === "froid" && "bg-froid-pale text-froid border-froid/30",
      )}
    >
      <span className={clsx("w-1.5 h-1.5 rounded-full", engagement === "chaud" ? "bg-chaud" : engagement === "tiede" ? "bg-or" : "bg-froid")} />
      {ENGAGEMENTS[engagement] ?? engagement}
    </span>
  );
}

export function Action({ action }: { action: string }) {
  const forte = action === "Transmettre" || action === "Alerte nouveau décideur";
  return (
    <span className={clsx("inline-block px-2 py-0.5 rounded-md text-xs whitespace-nowrap", forte ? "bg-or text-fond font-semibold" : "bg-surface-3 text-texte-2")}>
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
        famille === "declencheur" && "text-or-fort border-or/50 bg-or-pale",
        famille === "intention" && "text-chaud border-chaud/40 bg-chaud-pale",
        famille === "malus" && "text-alerte border-alerte/40 bg-alerte-pale",
      )}
    >
      {FAMILLES[famille] ?? famille}
    </span>
  );
}

/** Barre de score : adéquation (froid) puis chaleur (or) sur une échelle de 0 à 120. */
export function BarreScore({ adequation, chaleur, malus = 0 }: { adequation: number; chaleur: number; malus?: number }) {
  const echelle = 120;
  const a = Math.max(0, Math.min(adequation + malus, echelle));
  const c = Math.max(0, Math.min(chaleur, echelle - a));
  return (
    <div className="flex items-center gap-2 min-w-[150px]">
      <span className="chiffres w-8 text-right font-medium">{adequation + chaleur + malus}</span>
      <div className="flex-1 h-1.5 rounded-full bg-surface-3 overflow-hidden flex" aria-hidden>
        <span style={{ width: `${(a / echelle) * 100}%` }} className="bg-froid" />
        <span style={{ width: `${(c / echelle) * 100}%` }} className="bg-or" />
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
        {page < pages ? <Link href={lien(page + 1)} className="px-3 py-1.5 rounded-md bg-or text-fond font-semibold">Suivant</Link> : <span className="px-3 py-1.5 rounded-md bg-surface-2 opacity-50">Suivant</span>}
      </div>
    </div>
  );
}

export function Vide({ texte }: { texte: string }) {
  return <p className="px-5 py-10 text-center text-sm text-texte-2">{texte}</p>;
}
