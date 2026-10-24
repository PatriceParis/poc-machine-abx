import Link from "next/link";
import { listeSignaux } from "@/lib/donnees";
import { fDate, fNombre, q } from "@/lib/format";
import { Carte, Famille, Pagination, Palier, Vide } from "@/components/ui";
import { Filtres, classeChamp } from "@/components/filtres";

export const metadata = { title: "Signaux · Machine à leads" };

function precision(detail: Record<string, unknown>): string {
  const morceaux = [detail.page, detail.reseau, detail.poste, detail.nom].filter((v) => typeof v === "string" && v);
  return morceaux.join(" · ");
}

export default async function Signaux({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const famille = q(sp, "famille");
  const page = Math.max(1, Number(q(sp, "page")) || 1);
  const { total, lignes } = await listeSignaux({ famille, page });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-titre text-4xl">Signaux</h1>
        <span className="text-xs text-texte-3 chiffres">{fNombre(total)} signaux</span>
      </div>
      <Filtres action="/signaux">
        <label className="sr-only" htmlFor="famille">Famille</label>
        <select id="famille" name="famille" defaultValue={famille} className={classeChamp}>
          <option value="">Déclencheurs et intentions</option>
          <option value="declencheur">Déclencheurs</option>
          <option value="intention">Intentions</option>
        </select>
      </Filtres>
      <Carte>
        {lignes.length ? (
          <ol className="relative px-5 py-4 flex flex-col">
            {lignes.map((s) => (
              <li key={s.id} className="grid grid-cols-[90px_1fr] gap-4 py-3 border-b border-bord/60 last:border-0">
                <span className="text-xs text-texte-3 chiffres pt-0.5">{fDate(s.survenu_le)}</span>
                <div className="flex flex-col gap-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <Link href={`/comptes/${s.compte_id}`} className="font-medium hover:text-or-fort">{s.compte}</Link>
                    <Palier palier={s.palier} />
                    <span className="chiffres text-xs text-texte-3">score {s.score}</span>
                  </p>
                  <p className="flex flex-wrap items-center gap-2 text-sm">
                    <Famille famille={s.famille} />
                    <span>{s.libelle}</span>
                    <span className="chiffres text-texte-2">+{s.points}</span>
                  </p>
                  <p className="text-xs text-texte-3">
                    {[s.source, s.contact && `${s.contact}${s.poste ? `, ${s.poste}` : ""}`, precision(s.detail)].filter(Boolean).join(" · ")}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        ) : <Vide texte="Aucun signal de chaleur pour l'instant. Les premiers arriveront avec le suivi du site, les relevés des posts et la surveillance des prises de poste." />}
        <Pagination page={page} total={total} base="/signaux" params={{ famille }} />
      </Carte>
    </div>
  );
}
