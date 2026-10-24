"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { Building2, Gauge, ListChecks, LogOut, Users, Zap } from "lucide-react";

export const PAGES = [
  { href: "/", nom: "Cockpit", icone: Gauge },
  { href: "/comptes", nom: "Comptes", icone: Building2 },
  { href: "/signaux", nom: "Signaux", icone: Zap },
  { href: "/contacts", nom: "Contacts", icone: Users },
  { href: "/grille", nom: "Grille", icone: ListChecks },
];

export function Navigation({ protege }: { protege: boolean }) {
  const chemin = usePathname();
  const actif = (href: string) => (href === "/" ? chemin === "/" : chemin.startsWith(href));
  return (
    <>
      {/* Barre latérale, écran large */}
      <nav aria-label="Navigation" className="hidden md:flex fixed left-3 top-3 bottom-3 w-14 flex-col items-center gap-2 rounded-2xl bg-surface border border-bord py-3 z-20">
        <Link href="/" className="w-9 h-9 rounded-full bg-accent text-white grid place-items-center font-titre text-lg mb-3" title="Machine à leads Hirondo">H</Link>
        {PAGES.map(({ href, nom, icone: Icone }) => (
          <Link key={href} href={href} title={nom} aria-current={actif(href) ? "page" : undefined}
            className={clsx("w-10 h-10 rounded-full grid place-items-center", actif(href) ? "bg-accent text-white" : "text-texte-2 hover:text-texte hover:bg-surface-3")}>
            <Icone className="w-[18px] h-[18px]" />
          </Link>
        ))}
        <span className="flex-1" />
        {protege && (
          <a href="/api/logout" title="Se déconnecter" className="w-10 h-10 rounded-full grid place-items-center text-texte-3 hover:text-texte hover:bg-surface-3">
            <LogOut className="w-[18px] h-[18px]" />
          </a>
        )}
      </nav>
      {/* Onglets, écran étroit */}
      <nav aria-label="Navigation" className="md:hidden flex gap-1 overflow-x-auto px-4 pt-3">
        {PAGES.map(({ href, nom }) => (
          <Link key={href} href={href} aria-current={actif(href) ? "page" : undefined}
            className={clsx("px-3 py-1.5 rounded-full text-sm whitespace-nowrap", actif(href) ? "bg-accent text-white font-semibold" : "bg-surface text-texte-2")}>
            {nom}
          </Link>
        ))}
      </nav>
    </>
  );
}
