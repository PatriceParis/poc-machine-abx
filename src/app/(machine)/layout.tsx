import { Navigation } from "@/components/navigation";
import { baseConfiguree, requete } from "@/lib/db";
import { fDateHeure } from "@/lib/format";
import { SOURCES } from "@/lib/donnees";

export const dynamic = "force-dynamic";

/** Prochain lundi 5 h, heure de Paris (date de la mise à jour hebdomadaire), au format « lundi 3 nov. ». */
function prochainLundi(): string {
  const paris = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Paris" }));
  const ecart = (8 - paris.getDay()) % 7 || (paris.getHours() < 5 ? 0 : 7);
  const lundi = new Date(paris.getFullYear(), paris.getMonth(), paris.getDate() + ecart);
  return lundi.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "short" });
}

async function etat() {
  if (!baseConfiguree()) return null;
  try {
    // Date affichée : la dernière mise à jour hebdomadaire (lundi 5 h), à défaut le dernier changement des données.
    const [l] = await requete<{ maj: string | null; hebdo: string | null; types: string[] | null; evts: string[] | null }>(
      `select greatest((select max(cree_le) from signaux), (select max(mis_a_jour_le) from comptes), (select max(recu_le) from evenements_bruts)) as maj,
              (select max(lance_le) from releves where nature = 'tache' and detail->>'hebdo' = 'true') as hebdo,
              (select array_agg(distinct type_code) from signaux) as types,
              (select array_agg(distinct source) from evenements_bruts) as evts`);
    const types = new Set(l?.types ?? []);
    const evts = new Set(l?.evts ?? []);
    const actives = SOURCES.filter((s) => s.cle === "pharow" ? types.size > 0 : s.types.some((t) => types.has(t)) || (s.evenements && evts.has(s.evenements)));
    return { maj: l?.hebdo ?? l?.maj ?? null, actives: actives.map((s) => s.nom) };
  } catch {
    return null;
  }
}

export default async function MachineLayout({ children }: { children: React.ReactNode }) {
  const e = await etat();
  const protege = Boolean(process.env.DASHBOARD_PASSWORD);
  return (
    <div className="min-h-screen">
      <Navigation protege={protege} />
      <div className="md:pl-[84px] px-4 md:pr-6 pb-10">
        <header className="pt-4 flex flex-col gap-3">
          <div className="text-xs text-texte-2 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="inline-flex items-center gap-1.5 font-medium text-texte">
              <span className={e ? "w-2 h-2 rounded-full bg-ok" : "w-2 h-2 rounded-full bg-alerte"} />
              {e ? `Mis à jour le ${fDateHeure(e.maj)}` : "Base non joignable"}
            </span>
            {e && <span>· prochaine mise à jour {prochainLundi()} à 5 h</span>}
            {e && (
              <span>
                · {e.actives.length}/{SOURCES.length} sources actives{e.actives.length ? ` : ${e.actives.join(", ")}` : ""}
              </span>
            )}
          </div>
        </header>
        <main className="mt-5">{children}</main>
        <footer className="mt-10 flex flex-col gap-1.5 text-xs text-texte-3">
          <p>
            Cockpit Hirondo ABX · données de ciblage et de campagne, usage interne · Adresse IP des visiteurs jamais conservée ·
            IP address data is powered by IPinfo
          </p>
          <a href="https://flow-ops.pro/" target="_blank" rel="noopener" className="self-start font-bold text-texte-2 hover:text-accent-fort">
            Powered by Flow Ops
          </a>
        </footer>
      </div>
    </div>
  );
}
