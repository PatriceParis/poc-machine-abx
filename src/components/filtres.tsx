"use client";

import { useRef } from "react";

// Formulaire de filtres en GET : chaque changement relance la recherche, sans bouton.
export function Filtres({ action, children }: { action: string; children: React.ReactNode }) {
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form ref={ref} action={action} method="get" className="flex flex-wrap items-center gap-2"
      onChange={(e) => { if ((e.target as HTMLElement).tagName === "SELECT") ref.current?.requestSubmit(); }}>
      {children}
    </form>
  );
}

export const classeChamp = "rounded-lg border border-bord bg-surface-2 text-sm px-3 py-1.5 text-texte";
