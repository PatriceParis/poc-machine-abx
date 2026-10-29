import Link from "next/link";
import { visitesLeadfeeder, visitesSite } from "@/lib/donnees";
import { fDate, fDateHeure, fNombre, q } from "@/lib/format";
import { Carte, Palier, TitreSection, Tuile, Vide } from "@/components/ui";
import { Filtres, classeChamp } from "@/components/filtres";

export const metadata = { title: "Visites · Cockpit Hirondo ABX" };

const PERIODES = [7, 30, 90];
const chemin = (page: string) => page.replace(/^[^/]+/, "") || "/";
const pourcent = (n: number, total: number) => (total ? `${Math.round((100 * n) / total)} %` : "Aucune visite");

export default async function Visites({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const jours = PERIODES.includes(Number(q(sp, "jours"))) ? Number(q(sp, "jours")) : 30;
  const [{ chiffres: c, entreprises, autres, recentes }, { chiffres: lc, entreprises: lf }] = await Promise.all([visitesSite(jours), visitesLeadfeeder(jours)]);
  const n = (k: string) => Number(c?.[k] ?? 0);
  const nl = (k: string) => Number(lc?.[k] ?? 0);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-titre text-4xl">Visites du site</h1>
          <p className="text-sm text-texte-2 mt-1">hirondo.co · deux identifications comparées : le réseau d&apos;où vient la visite (IPinfo Lite, sans cookie) et la base d&apos;entreprises de Leadfeeder</p>
        </div>
        <Filtres action="/visites">
          <label className="sr-only" htmlFor="jours">Période</label>
          <select id="jours" name="jours" defaultValue={String(jours)} className={classeChamp}>
            {PERIODES.map((p) => <option key={p} value={p}>{p} derniers jours</option>)}
          </select>
        </Filtres>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tuile titre="Pages vues" valeur={fNombre(n("pages_vues"))} aide={`${fNombre(n("visiteurs"))} visiteurs uniques`} />
        <Tuile accent titre="Visiteurs reconnus" valeur={pourcent(n("visiteurs_entreprise"), n("visiteurs"))}
          aide={`${fNombre(n("visiteurs_entreprise"))} sur ${fNombre(n("visiteurs"))} viennent du réseau d'une entreprise`} />
        <Tuile titre="Entreprises reconnues" valeur={fNombre(n("entreprises"))}
          aide={`${fNombre(n("comptes"))} dans la base, ${fNombre(n("visiteurs_comptes"))} visiteurs`} />
        <Tuile titre="Non identifiables" valeur={pourcent(n("visiteurs_operateur") + n("visiteurs_inconnus"), n("visiteurs"))}
          aide="box, mobile, VPN ou hébergeur : aucun nom d'entreprise" />
      </div>

      <Carte>
        <TitreSection titre="Entreprises reconnues par Leadfeeder"
          aide={`Leadfeeder rapproche l'adresse IP de sa base d'entreprises : il reconnaît aussi des entreprises sans réseau propre, invisibles pour IPinfo Lite. Relevé chaque jour${lc?.premiere ? `, depuis le ${fDate(String(lc.premiere))}` : ""}${lc?.releve ? ` (dernier relevé ${fDateHeure(String(lc.releve))})` : ""}. Seuls les comptes de la base font un signal, un par jour et par compte quelle que soit la source.`}
          droite={<span className="text-xs text-texte-3 chiffres whitespace-nowrap">{fNombre(nl("entreprises"))} entreprises · {fNombre(nl("comptes"))} comptes · {fNombre(nl("comptes_deux"))} aussi vus par IPinfo (sur {fNombre(nl("comptes_ipinfo"))})</span>} />
        {lf.length ? (
          <div className="overflow-x-auto pt-3">
            <table className="w-full text-sm min-w-[820px]">
              <thead>
                <tr className="text-left text-xs text-texte-3 border-b border-bord">
                  <th className="font-normal px-5 py-2.5">Entreprise</th>
                  <th className="font-normal px-3 py-2.5">Compte de la base</th>
                  <th className="font-normal px-3 py-2.5 text-right">Visites</th>
                  <th className="font-normal px-3 py-2.5">Pages lues</th>
                  <th className="font-normal px-3 py-2.5">IPinfo Lite</th>
                  <th className="font-normal px-5 py-2.5">Dernière visite</th>
                </tr>
              </thead>
              <tbody>
                {lf.map((e) => (
                  <tr key={`${e.entreprise}-${e.domaine}`} className="border-b border-bord/60 last:border-0 hover:bg-surface-2 align-top">
                    <td className="px-5 py-2.5">
                      <span className="font-medium">{e.entreprise ?? "Entreprise non nommée"}</span>
                      <span className="block text-xs text-texte-3">
                        {[e.domaine, e.pays, e.effectif ? `${fNombre(e.effectif)} salariés` : null].filter(Boolean).join(" · ")}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      {e.compte_id && e.compte ? (
                        <span className="flex flex-wrap items-center gap-2">
                          <Link href={`/comptes/${e.compte_id}`} className="text-accent-fort hover:underline">{e.compte}</Link>
                          {e.palier && <Palier palier={e.palier} />}
                          {e.par && <span className="block w-full text-xs text-texte-3">par le {e.par}</span>}
                        </span>
                      ) : <span className="text-texte-3">Hors base</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right chiffres">{fNombre(e.visites)}</td>
                    <td className="px-3 py-2.5 text-xs text-texte-2">{(e.pages ?? []).join(", ")}</td>
                    <td className="px-3 py-2.5 text-xs">{e.vue_ipinfo ? "Aussi reconnue" : <span className="text-texte-3">Non vue</span>}</td>
                    <td className="px-5 py-2.5 text-xs text-texte-3 chiffres whitespace-nowrap">{fDateHeure(e.derniere)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Vide texte="Aucune visite reconnue par Leadfeeder sur la période. Le relevé passe chaque matin ; les visites de la veille apparaissent ici." />}
      </Carte>

      <Carte>
        <TitreSection titre="Entreprises reconnues par IPinfo Lite"
          aide="Le réseau d'une entreprise désigne l'entreprise, jamais la personne : une visite depuis le réseau d'une banque dit que quelqu'un dans cette banque a lu ces pages. Seuls les comptes de la base font un signal."
          droite={<span className="text-xs text-texte-3 chiffres whitespace-nowrap">{fNombre(entreprises.length)} réseaux</span>} />
        {entreprises.length ? (
          <div className="overflow-x-auto pt-3">
            <table className="w-full text-sm min-w-[820px]">
              <thead>
                <tr className="text-left text-xs text-texte-3 border-b border-bord">
                  <th className="font-normal px-5 py-2.5">Réseau d&apos;origine</th>
                  <th className="font-normal px-3 py-2.5">Compte de la base</th>
                  <th className="font-normal px-3 py-2.5 text-right">Visiteurs</th>
                  <th className="font-normal px-3 py-2.5 text-right">Pages vues</th>
                  <th className="font-normal px-3 py-2.5">Pages lues</th>
                  <th className="font-normal px-5 py-2.5">Dernière visite</th>
                </tr>
              </thead>
              <tbody>
                {entreprises.map((e) => (
                  <tr key={`${e.reseau}-${e.domaine}`} className="border-b border-bord/60 last:border-0 hover:bg-surface-2 align-top">
                    <td className="px-5 py-2.5">
                      <span className="font-medium">{e.reseau}</span>
                      <span className="block text-xs text-texte-3">{[e.domaine, e.pays].filter(Boolean).join(" · ")}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      {e.compte_id && e.compte ? (
                        <span className="flex flex-wrap items-center gap-2">
                          <Link href={`/comptes/${e.compte_id}`} className="text-accent-fort hover:underline">{e.compte}</Link>
                          {e.palier && <Palier palier={e.palier} />}
                          {e.par && <span className="block w-full text-xs text-texte-3">par le {e.par}</span>}
                        </span>
                      ) : <span className="text-texte-3">Hors base</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right chiffres">{fNombre(e.visiteurs)}</td>
                    <td className="px-3 py-2.5 text-right chiffres">{fNombre(e.pages_vues)}</td>
                    <td className="px-3 py-2.5 text-xs text-texte-2">{(e.pages ?? []).map(chemin).join(", ")}</td>
                    <td className="px-5 py-2.5 text-xs text-texte-3 chiffres whitespace-nowrap">{fDateHeure(e.derniere)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Vide texte="Aucune entreprise reconnue sur la période. Les visites venues d'un réseau d'entreprise apparaîtront ici dès leur réception." />}
      </Carte>

      <div className="grid lg:grid-cols-[1fr_1.4fr] gap-5 items-start">
        <Carte>
          <TitreSection titre="Visites non identifiables" aide="Réseaux d'opérateurs, de mobiles, de VPN ou d'hébergeurs, et adresses sans réseau trouvé." />
          {autres.length ? (
            <ul className="px-5 py-3 flex flex-col">
              {autres.map((a) => (
                <li key={`${a.reseau}-${a.nature}`} className="flex items-baseline justify-between gap-3 py-2 border-b border-bord/60 last:border-0 text-sm">
                  <span>{a.reseau}<span className="block text-xs text-texte-3">{a.nature === "inconnu" ? "réseau non trouvé" : "opérateur ou hébergeur"}</span></span>
                  <span className="chiffres text-texte-2 whitespace-nowrap">{fNombre(a.visiteurs)} visiteurs</span>
                </li>
              ))}
            </ul>
          ) : <Vide texte="Aucune visite non identifiable sur la période." />}
        </Carte>

        <Carte>
          <TitreSection titre="Dernières visites" aide="Une ligne par page vue, la plus récente en haut." />
          {recentes.length ? (
            <ol className="px-5 py-3 flex flex-col">
              {recentes.map((r, i) => (
                <li key={`${r.recu_le}-${i}`} className="grid grid-cols-[120px_1fr] gap-3 py-2 border-b border-bord/60 last:border-0 text-sm">
                  <span className="text-xs text-texte-3 chiffres pt-0.5">{fDateHeure(r.recu_le)}</span>
                  <span>
                    <span className="font-medium">{chemin(r.page)}</span>
                    <span className="block text-xs text-texte-3">
                      {r.reseau ?? "réseau non trouvé"}
                      {r.compte_id && r.compte ? (
                        <>{" · "}<Link href={`/comptes/${r.compte_id}`} className="text-accent-fort hover:underline">{r.compte}</Link></>
                      ) : r.nature === "entreprise" ? " · hors base" : ""}
                      {r.referent ? ` · venu de ${r.referent.replace(/^https?:\/\//, "").replace(/\/$/, "")}` : ""}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          ) : <Vide texte="Aucune visite reçue sur la période. Le script est en ligne sur hirondo.co : chaque page vue apparaît ici dans la minute." />}
        </Carte>
      </div>
    </div>
  );
}
