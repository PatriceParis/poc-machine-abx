import Link from "next/link";
import { listeComptes } from "@/lib/donnees";
import { fDate, fNombre, q } from "@/lib/format";
import { Action, BarreScore, Carte, Engagement, Pagination, Palier, Vide } from "@/components/ui";
import { Filtres, classeChamp } from "@/components/filtres";

export const metadata = { title: "Comptes · Machine à leads" };

export default async function Comptes({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const filtres = { palier: q(sp, "palier"), engagement: q(sp, "engagement"), activite: q(sp, "activite"), texte: q(sp, "texte") };
  const page = Math.max(1, Number(q(sp, "page")) || 1);
  const { total, lignes, activites } = await listeComptes({ ...filtres, page });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-titre text-4xl">Comptes</h1>
        <span className="text-xs text-texte-3 chiffres">{fNombre(total)} comptes</span>
      </div>
      <Filtres action="/comptes">
        <label className="sr-only" htmlFor="texte">Nom du compte</label>
        <input id="texte" name="texte" defaultValue={filtres.texte} placeholder="Nom du compte" className={`${classeChamp} w-56`} />
        <label className="sr-only" htmlFor="palier">Palier</label>
        <select id="palier" name="palier" defaultValue={filtres.palier} className={classeChamp}>
          <option value="">Tous les paliers</option>
          <option value="A">Fit A</option>
          <option value="B">Fit B</option>
          <option value="C">Fit C</option>
        </select>
        <label className="sr-only" htmlFor="engagement">Engagement</label>
        <select id="engagement" name="engagement" defaultValue={filtres.engagement} className={classeChamp}>
          <option value="">Tous les engagements</option>
          <option value="chaud">Chaud</option>
          <option value="tiede">Tiède</option>
          <option value="froid">Froid</option>
        </select>
        <label className="sr-only" htmlFor="activite">Activité</label>
        <select id="activite" name="activite" defaultValue={filtres.activite} className={`${classeChamp} max-w-64`}>
          <option value="">Toutes les activités</option>
          {activites.map((a) => <option key={a.activite} value={a.activite}>{a.activite} ({a.n})</option>)}
        </select>
        <button type="submit" className="px-3 py-1.5 rounded-lg bg-surface-3 text-sm">Rechercher</button>
        {(filtres.palier || filtres.engagement || filtres.activite || filtres.texte) && <Link href="/comptes" className="text-xs text-accent-fort hover:underline">Effacer les filtres</Link>}
      </Filtres>
      <Carte>
        <div className="overflow-x-auto">
          {lignes.length ? (
            <table className="w-full text-sm min-w-[880px]">
              <thead>
                <tr className="text-left text-xs text-texte-3 border-b border-bord">
                  <th className="font-normal px-5 py-2.5">Compte</th>
                  <th className="font-normal px-3 py-2.5">Activité</th>
                  <th className="font-normal px-3 py-2.5">Effectif</th>
                  <th className="font-normal px-3 py-2.5">Fit · engagement</th>
                  <th className="font-normal px-3 py-2.5">Score</th>
                  <th className="font-normal px-3 py-2.5">Action</th>
                  <th className="font-normal px-3 py-2.5 text-right">Signaux</th>
                  <th className="font-normal px-5 py-2.5">Dernier signal</th>
                </tr>
              </thead>
              <tbody>
                {lignes.map((l) => (
                  <tr key={l.compte_id} className="border-b border-bord/60 hover:bg-surface-2">
                    <td className="px-5 py-2.5"><Link href={`/comptes/${l.compte_id}`} className="font-medium hover:text-accent-fort">{l.nom}</Link></td>
                    <td className="px-3 py-2.5 text-texte-2">{l.activite ?? "n.c."}</td>
                    <td className="px-3 py-2.5 text-texte-2 chiffres whitespace-nowrap">{l.tranche_effectif ?? "n.c."}</td>
                    <td className="px-3 py-2.5"><span className="flex items-center gap-2"><Palier palier={l.palier} /><Engagement engagement={l.engagement} /></span></td>
                    <td className="px-3 py-2.5"><BarreScore adequation={l.adequation} chaleur={l.chaleur} /></td>
                    <td className="px-3 py-2.5"><Action action={l.action} /></td>
                    <td className="px-3 py-2.5 text-right chiffres">{l.nb_signaux}</td>
                    <td className="px-5 py-2.5 text-texte-2 whitespace-nowrap">{l.dernier_signal ? fDate(l.dernier_signal) : "Aucun"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <Vide texte="Aucun compte ne correspond à ces filtres." />}
        </div>
        <Pagination page={page} total={total} base="/comptes" params={filtres} />
      </Carte>
    </div>
  );
}
