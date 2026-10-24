import Link from "next/link";
import clsx from "clsx";
import { cockpit } from "@/lib/donnees";
import { fDate, fDateHeure, fNombre } from "@/lib/format";
import { Action, BarreScore, Carte, Engagement, Palier, TitreSection, Vide } from "@/components/ui";

export const metadata = { title: "Cockpit · Machine à leads" };

const ACTIONS_CASE: Record<string, Record<string, string>> = {
  A: { chaud: "Transmettre", tiede: "Reciblage et contenu", froid: "Audience de comptes" },
  B: { chaud: "Transmettre", tiede: "Reciblage", froid: "À surveiller" },
  C: { chaud: "À surveiller", tiede: "À surveiller", froid: "À surveiller" },
};

function Tuile({ titre, valeur, aide, accent }: { titre: string; valeur: string; aide: string; accent?: boolean }) {
  return (
    <div className={clsx("rounded-xl border px-4 py-3.5 flex flex-col gap-1", accent ? "bg-or text-fond border-or" : "bg-surface border-bord")}>
      <span className={clsx("text-xs", accent ? "text-fond/80 font-medium" : "text-texte-2")}>{titre}</span>
      <span className={clsx("chiffres text-3xl", accent && "font-semibold")}>{valeur}</span>
      <span className={clsx("text-xs", accent ? "text-fond/75" : "text-texte-3")}>{aide}</span>
    </div>
  );
}

export default async function Cockpit() {
  const { chiffres: c, matrice, top, actions, sources, familles30 } = await cockpit();
  const n = (k: string) => Number(c[k] ?? 0);
  const cellule = (p: string, e: string) => matrice.find((m) => m.palier === p && m.engagement === e)?.n ?? 0;
  const actives = sources.filter((s) => s.actif).length;
  const intentions30 = familles30.find((f) => f.famille === "intention")?.n ?? 0;
  const declencheurs30 = familles30.find((f) => f.famille === "declencheur")?.n ?? 0;
  const maxFamille = Math.max(1, intentions30, declencheurs30);
  const totalActions = actions.reduce((a, l) => a + l.n, 0) || 1;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-titre text-4xl">Cockpit · {fNombre(n("comptes"))} comptes suivis</h1>
        <Link href="/comptes" className="text-sm text-or-fort hover:underline underline-offset-4">Tous les comptes</Link>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tuile titre="Comptes de la base" valeur={fNombre(n("comptes"))} aide="Banque, assurance, services financiers, client exclu" />
        <Tuile titre="Sources actives" valeur={`${actives}/${sources.length}`} aide={`${sources.length - actives} à brancher`} />
        <Tuile titre="Signaux sur 30 jours" valeur={fNombre(n("signaux_30"))} aide={`${fNombre(n("signaux_total"))} au total`} />
        <Tuile titre="Contacts nommés" valeur={fNombre(n("contacts"))} aide={`${fNombre(n("contacts_cibles"))} en marketing, growth ou direction`} />
        <div className="col-span-2">
          <Tuile accent titre="À traiter" valeur={fNombre(n("a_traiter"))} aide="comptes chauds ou alertes qui attendent une action commerciale" />
        </div>
        <Tuile titre="Intentions" valeur={fNombre(n("intentions_30"))} aide="visites, engagement, test, emails, 30 jours" />
        <Tuile titre="Déclencheurs" valeur={fNombre(n("declencheurs_30"))} aide="prises de poste, départs, recrutements, 30 jours" />
      </div>

      <Carte>
        <TitreSection titre="Adéquation × engagement"
          aide="L'adéquation dit qui viser (taille, secteur, décideur identifié). L'engagement dit qui s'intéresse déjà (visites, posts, test, emails, prises de poste). Un clic ouvre la liste."
          droite={<span className="text-xs text-texte-3 chiffres whitespace-nowrap">{fNombre(n("comptes"))} comptes</span>} />
        <div className="overflow-x-auto px-5 pb-5 pt-4">
          <div className="grid grid-cols-[56px_repeat(3,minmax(150px,1fr))] gap-2 min-w-[540px]">
            <span />
            {["chaud", "tiede", "froid"].map((e) => (
              <span key={e} className="etiquette text-center">{e === "chaud" ? "Engagement chaud" : e === "tiede" ? "Tiède" : "Froid"}</span>
            ))}
            {["A", "B", "C"].map((p) => (
              <div key={p} className="contents">
                <span className="flex items-center gap-2 text-xs text-texte-2"><Palier palier={p} /> Fit {p}</span>
                {["chaud", "tiede", "froid"].map((e) => {
                  const v = cellule(p, e);
                  const transmise = ACTIONS_CASE[p][e] === "Transmettre";
                  return (
                    <Link key={e} href={`/comptes?palier=${p}&engagement=${e}`}
                      className={clsx("rounded-lg border px-4 py-3 flex flex-col gap-1 hover:border-or/70",
                        transmise ? "bg-or-pale border-or/50" : v > 0 && p !== "C" ? "bg-surface-2 border-or/25" : "bg-surface-2 border-bord")}>
                      <span className="chiffres text-2xl">{fNombre(v)}</span>
                      <span className="text-xs text-texte-2">{ACTIONS_CASE[p][e]}</span>
                    </Link>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </Carte>

      <Carte>
        <TitreSection titre="Le flux de la machine" aide="Chaque source alimente le score, le palier et la chaleur décident de l'action. Rien ne part vers Hirondo sans validation." />
        <div className="grid lg:grid-cols-[1.3fr_1fr_1fr] gap-4 p-5">
          <div className="flex flex-col gap-2">
            <span className="etiquette">1 · Sources</span>
            {sources.map((s) => (
              <div key={s.cle} className="rounded-lg border border-bord bg-surface-2 px-3 py-2 flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm flex items-center gap-2">
                    <span className={clsx("w-1.5 h-1.5 rounded-full", s.actif ? "bg-ok" : "bg-texte-3")} />
                    {s.nom}
                  </p>
                  <p className="text-xs text-texte-3 mt-0.5">
                    {s.cle === "pharow" ? `${fNombre(s.n)} comptes` : s.actif ? `${fNombre(s.n)} signaux${s.nEvt ? ` · ${fNombre(s.nEvt)} événements reçus` : ""}` : "À brancher"} · {s.detail}
                  </p>
                </div>
                <span className="etiquette whitespace-nowrap">{s.nature}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-2">
            <span className="etiquette">2 · Scoring</span>
            <div className="rounded-lg bg-fond border border-bord p-4 flex flex-col gap-4">
              <p className="etiquette text-texte-2">Moteur de score</p>
              {[
                { nom: "Adéquation", info: "taille, secteur, décideur", couleur: "bg-froid", v: null },
                { nom: "Déclencheurs", info: "30 jours", couleur: "bg-or", v: declencheurs30 },
                { nom: "Intentions", info: "30 jours", couleur: "bg-chaud", v: intentions30 },
              ].map((f) => (
                <div key={f.nom} className="flex flex-col gap-1.5">
                  <div className="flex justify-between text-sm"><span>{f.nom}</span><span className="chiffres text-texte-2">{f.v == null ? f.info : fNombre(f.v)}</span></div>
                  <div className="h-1.5 rounded-full bg-surface-3 overflow-hidden">
                    <span className={clsx("block h-full", f.couleur)} style={{ width: f.v == null ? "100%" : `${(f.v / maxFamille) * 100}%` }} />
                  </div>
                </div>
              ))}
              <p className="text-xs text-texte-2">Adéquation + déclencheurs + intentions, moins les malus. Grille modifiable dans <Link href="/grille" className="text-or-fort underline underline-offset-4">Grille</Link>.</p>
            </div>
            <p className="text-xs text-texte-3">Visites du site : {fNombre(n("visites"))} reçues, {fNombre(n("visites_identifiees"))} rattachées à un compte.</p>
          </div>
          <div className="flex flex-col gap-2">
            <span className="etiquette">3 · Aiguillage par case</span>
            {[
              { nom: "Transmission à Yannig ou Patrice", info: "A ou B chaud, test qualifiant", d: "audit CRM sous 80 de chaleur, exécution ABM au-delà" },
              { nom: "Alerte nouveau décideur", info: "palier A", d: "angle des 90 premiers jours, quelle que soit la chaleur" },
              { nom: "Reciblage LinkedIn", info: "A et B tièdes", d: "audience de comptes, contenu de Yannig" },
              { nom: "Audience de comptes", info: "A froid", d: "vidéo et étude de cas en notoriété" },
              { nom: "À surveiller", info: "B froid et palier C", d: "jamais transmis" },
            ].map((r) => (
              <div key={r.nom} className="rounded-lg border border-bord bg-surface-2 px-3 py-2">
                <p className="text-sm flex justify-between gap-2"><span>{r.nom}</span><span className="etiquette whitespace-nowrap">{r.info}</span></p>
                <p className="text-xs text-texte-3 mt-0.5">{r.d}</p>
              </div>
            ))}
          </div>
        </div>
      </Carte>

      <Carte>
        <TitreSection titre="Les comptes, par score" aide="Classés par score total. Un clic ouvre la fiche." />
        <div className="overflow-x-auto mt-3">
          {top.length ? (
            <table className="w-full text-sm min-w-[820px]">
              <thead>
                <tr className="text-left text-xs text-texte-3 border-b border-bord">
                  <th className="font-normal px-5 py-2">Compte</th>
                  <th className="font-normal px-3 py-2">Fit · engagement</th>
                  <th className="font-normal px-3 py-2">Action</th>
                  <th className="font-normal px-3 py-2">Score</th>
                  <th className="font-normal px-3 py-2 text-right">Signaux</th>
                  <th className="font-normal px-3 py-2 text-right">Contacts</th>
                  <th className="font-normal px-5 py-2">Dernier signal</th>
                </tr>
              </thead>
              <tbody>
                {top.map((l) => (
                  <tr key={l.compte_id} className="border-b border-bord/60 hover:bg-surface-2">
                    <td className="px-5 py-2.5">
                      <Link href={`/comptes/${l.compte_id}`} className="font-medium hover:text-or-fort">{l.nom}</Link>
                      <p className="text-xs text-texte-3">{[l.activite, l.tranche_effectif && `${l.tranche_effectif} salariés`].filter(Boolean).join(" · ")}</p>
                    </td>
                    <td className="px-3 py-2.5"><span className="flex items-center gap-2"><Palier palier={l.palier} /><Engagement engagement={l.engagement} /></span></td>
                    <td className="px-3 py-2.5"><Action action={l.action} /></td>
                    <td className="px-3 py-2.5"><BarreScore adequation={l.adequation} chaleur={l.chaleur} malus={l.malus} /></td>
                    <td className="px-3 py-2.5 text-right chiffres">{l.nb_signaux}</td>
                    <td className="px-3 py-2.5 text-right chiffres">{l.contacts}</td>
                    <td className="px-5 py-2.5 text-texte-2 whitespace-nowrap">{l.dernier_signal ? fDate(l.dernier_signal) : "Aucun"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <Vide texte="Aucun compte dans la base pour l'instant." />}
        </div>
      </Carte>

      <div className="grid lg:grid-cols-2 gap-5">
        <Carte>
          <TitreSection titre="Signaux des 30 derniers jours" aide="Ce qui fait monter la chaleur. L'adéquation, fixe, n'y figure pas." />
          <div className="p-5 flex flex-col gap-3">
            {[{ f: "Déclencheurs", v: declencheurs30, c: "bg-or" }, { f: "Intentions", v: intentions30, c: "bg-chaud" }].map((r) => (
              <div key={r.f} className="grid grid-cols-[110px_1fr_40px] items-center gap-3">
                <span className="text-xs text-texte-2">{r.f}</span>
                <div className="h-2 rounded-full bg-surface-3 overflow-hidden"><span className={clsx("block h-full", r.c)} style={{ width: `${(r.v / maxFamille) * 100}%` }} /></div>
                <span className="chiffres text-right">{r.v}</span>
              </div>
            ))}
            {declencheurs30 + intentions30 === 0 && <p className="text-xs text-texte-3">Aucun signal de chaleur encore : les relevés et le suivi du site démarrent.</p>}
          </div>
        </Carte>
        <Carte>
          <TitreSection titre="Répartition par action" aide="Ce que la machine propose de faire de chaque compte aujourd'hui." />
          <div className="p-5 flex flex-col gap-3">
            {actions.map((a) => (
              <div key={a.action} className="grid grid-cols-[170px_1fr_50px] items-center gap-3">
                <Action action={a.action} />
                <div className="h-2 rounded-full bg-surface-3 overflow-hidden"><span className="block h-full bg-froid" style={{ width: `${(a.n / totalActions) * 100}%` }} /></div>
                <span className="chiffres text-right">{fNombre(a.n)}</span>
              </div>
            ))}
          </div>
        </Carte>
      </div>
      <p className="text-xs text-texte-3">Dernier import de la base : {fDateHeure(c.dernier_import as string | null)}</p>
    </div>
  );
}
