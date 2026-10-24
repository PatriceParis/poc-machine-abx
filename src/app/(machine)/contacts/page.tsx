import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { listeContacts } from "@/lib/donnees";
import { FONCTIONS, estDecideur, fNombre, q } from "@/lib/format";
import { Carte, Engagement, Pagination, Palier, Vide } from "@/components/ui";
import { Filtres, classeChamp } from "@/components/filtres";
import { MarqueVerif } from "@/components/enrichir";

export const metadata = { title: "Contacts · Cockpit Hirondo ABX" };

export default async function Contacts({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const filtres = { fonction: q(sp, "fonction"), palier: q(sp, "palier"), texte: q(sp, "texte"), decideurs: q(sp, "decideurs") };
  const page = Math.max(1, Number(q(sp, "page")) || 1);
  const { total, lignes } = await listeContacts({ ...filtres, decideurs: filtres.decideurs === "1", page });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-titre text-4xl">Contacts</h1>
        <span className="text-xs text-texte-3 chiffres">{fNombre(total)} contacts</span>
      </div>
      <Filtres action="/contacts">
        <label className="sr-only" htmlFor="texte-contact">Nom, poste ou compte</label>
        <input id="texte-contact" name="texte" defaultValue={filtres.texte} placeholder="Nom, poste ou compte" className={`${classeChamp} w-56`} />
        <label className="sr-only" htmlFor="decideurs">Niveau</label>
        <select id="decideurs" name="decideurs" defaultValue={filtres.decideurs} className={classeChamp}>
          <option value="">Tous les niveaux</option>
          <option value="1">Décideurs marketing</option>
        </select>
        <label className="sr-only" htmlFor="fonction">Fonction</label>
        <select id="fonction" name="fonction" defaultValue={filtres.fonction} className={classeChamp}>
          <option value="">Toutes les fonctions</option>
          {Object.entries(FONCTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <label className="sr-only" htmlFor="palier-contact">Palier du compte</label>
        <select id="palier-contact" name="palier" defaultValue={filtres.palier} className={classeChamp}>
          <option value="">Tous les paliers</option>
          <option value="A">Comptes A</option>
          <option value="B">Comptes B</option>
          <option value="C">Comptes C</option>
        </select>
        <button type="submit" className="px-3 py-1.5 rounded-lg bg-surface-3 text-sm">Rechercher</button>
      </Filtres>
      <Carte>
        <div className="overflow-x-auto">
          {lignes.length ? (
            <table className="w-full text-sm min-w-[860px]">
              <thead>
                <tr className="text-left text-xs text-texte-3 border-b border-bord">
                  <th className="font-normal px-5 py-2.5">Contact</th>
                  <th className="font-normal px-3 py-2.5">Compte</th>
                  <th className="font-normal px-3 py-2.5">Persona</th>
                  <th className="font-normal px-3 py-2.5 text-right">Score du compte</th>
                  <th className="font-normal px-3 py-2.5">Engagement</th>
                  <th className="font-normal px-3 py-2.5">Email</th>
                  <th className="font-normal px-5 py-2.5">LinkedIn</th>
                </tr>
              </thead>
              <tbody>
                {lignes.map((ct) => (
                  <tr key={ct.id} className="border-b border-bord/60 hover:bg-surface-2">
                    <td className="px-5 py-2.5">
                      <p className="font-medium">{[ct.prenom, ct.nom].filter(Boolean).join(" ") || "Sans nom"}</p>
                      <p className="text-xs text-texte-3 max-w-[38ch] truncate" title={ct.poste ?? ""}>{ct.poste}</p>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="flex items-center gap-2"><Palier palier={ct.palier} /><Link href={`/comptes/${ct.compte_id}`} className="hover:text-accent-fort">{ct.compte}</Link></span>
                    </td>
                    <td className="px-3 py-2.5 text-texte-2">{estDecideur(ct.poste) ? "Décideur marketing" : FONCTIONS[ct.fonction] ?? ct.fonction}</td>
                    <td className="px-3 py-2.5 text-right chiffres">{ct.score}</td>
                    <td className="px-3 py-2.5"><Engagement engagement={ct.engagement} /></td>
                    <td className="px-3 py-2.5 text-texte-2">
                      {ct.email ? "Oui" : "Non"}
                      {ct.email && ct.email_verif && <MarqueVerif verif={ct.email_verif} detail={ct.email_verif_detail} />}
                    </td>
                    <td className="px-5 py-2.5">{ct.url_linkedin && <a href={ct.url_linkedin} target="_blank" rel="noopener" className="text-accent-fort hover:underline inline-flex items-center gap-1">Profil <ExternalLink className="w-3 h-3" /></a>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <Vide texte="Aucun contact ne correspond à ces filtres." />}
        </div>
        <Pagination page={page} total={total} base="/contacts" params={filtres} />
      </Carte>
    </div>
  );
}
