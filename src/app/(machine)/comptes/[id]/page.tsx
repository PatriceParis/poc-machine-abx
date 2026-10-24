import Link from "next/link";
import { notFound } from "next/navigation";
import clsx from "clsx";
import { ExternalLink } from "lucide-react";
import { ficheCompte } from "@/lib/donnees";
import { FONCTIONS, estDecideur, fDate } from "@/lib/format";
import { Action, BarreScore, Carte, Engagement, Famille, Palier, TitreSection, Vide } from "@/components/ui";
import { Coordonnee } from "@/components/enrichir";

export const metadata = { title: "Fiche compte · Machine à leads" };

export default async function FicheCompte({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const fiche = await ficheCompte(Number(id));
  if (!fiche) notFound();
  const { compte: c, signaux, contacts } = fiche;
  const chaleur = signaux.filter((s) => s.famille !== "adequation" && s.famille !== "malus");
  const fixes = signaux.filter((s) => s.famille === "adequation" || s.famille === "malus");

  return (
    <div className="flex flex-col gap-5">
      <Link href="/comptes" className="text-xs text-texte-2 hover:text-texte">← Comptes</Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-titre text-4xl">{c.nom}</h1>
          <p className="text-sm text-texte-2 mt-1">{[c.activite, c.tranche_effectif && `${c.tranche_effectif} salariés`].filter(Boolean).join(" · ")}</p>
          <div className="flex flex-wrap gap-3 mt-2 text-xs">
            {c.site && <a href={c.site} target="_blank" rel="noopener" className="text-accent-fort inline-flex items-center gap-1 hover:underline">Site <ExternalLink className="w-3 h-3" /></a>}
            {c.url_linkedin && <a href={c.url_linkedin} target="_blank" rel="noopener" className="text-accent-fort inline-flex items-center gap-1 hover:underline">Page LinkedIn <ExternalLink className="w-3 h-3" /></a>}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Palier palier={c.palier} />
          <Engagement engagement={c.engagement} />
          <Action action={c.action} />
        </div>
      </div>

      <div className="grid sm:grid-cols-3 gap-3">
        {[
          { t: "Score sur 100", v: c.score },
          { t: "Adéquation sur 40", v: c.adequation },
          { t: "Chaleur sur 60", v: c.chaleur },
        ].map((x) => (
          <div key={x.t} className="rounded-xl border border-bord bg-surface px-4 py-3">
            <p className="text-xs text-texte-2">{x.t}</p>
            <p className="chiffres text-2xl mt-1">{x.v}</p>
          </div>
        ))}
      </div>
      {c.exclu && <p className="text-sm text-alerte">Compte exclu : {c.motif_exclusion}</p>}
      <BarreScore adequation={c.adequation} chaleur={c.chaleur} />

      <div className="grid lg:grid-cols-[1.4fr_1fr] gap-5">
        <Carte>
          <TitreSection titre="Signaux de chaleur" aide="Déclencheurs et intentions. Un signal expiré reste visible mais ne compte plus." />
          {chaleur.length ? (
            <ul className="p-5 flex flex-col gap-3">
              {chaleur.map((s) => (
                <li key={s.id} className={clsx("flex items-start justify-between gap-3 border-l-2 pl-3", s.actif ? "border-accent" : "border-bord opacity-60")}>
                  <div>
                    <p className="text-sm">{s.libelle}</p>
                    <p className="text-xs text-texte-3">{fDate(s.survenu_le)} · {s.source}{s.contact ? ` · ${s.contact}` : ""}{s.actif ? "" : " · expiré"}</p>
                  </div>
                  <span className="flex items-center gap-2"><Famille famille={s.famille} /><span className="chiffres text-sm">+{s.points}</span></span>
                </li>
              ))}
            </ul>
          ) : <Vide texte="Aucun signal de chaleur pour ce compte." />}
        </Carte>
        <Carte>
          <TitreSection titre="Adéquation" aide="Ce qu'est le compte, fixe." />
          <ul className="p-5 flex flex-col gap-2">
            {fixes.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 text-sm">
                <span>{s.libelle}</span>
                <span className="chiffres">{s.points > 0 ? `+${s.points}` : s.points}</span>
              </li>
            ))}
          </ul>
        </Carte>
      </div>

      <Carte>
        <TitreSection titre={`Contacts (${contacts.length})`} aide="Décideurs marketing en premier." />
        {contacts.length ? (
          <div className="overflow-x-auto mt-3">
            <table className="w-full text-sm min-w-[820px]">
              <thead>
                <tr className="text-left text-xs text-texte-3 border-b border-bord">
                  <th className="font-normal px-5 py-2">Contact</th>
                  <th className="font-normal px-3 py-2">Fonction</th>
                  <th className="font-normal px-3 py-2">Email</th>
                  <th className="font-normal px-3 py-2">Téléphone</th>
                  <th className="font-normal px-5 py-2">LinkedIn</th>
                </tr>
              </thead>
              <tbody>
                {[...contacts].sort((a, b) => Number(estDecideur(b.poste)) - Number(estDecideur(a.poste))).map((ct) => (
                  <tr key={ct.id} className="border-b border-bord/60">
                    <td className="px-5 py-2.5">
                      <p className="font-medium">{[ct.prenom, ct.nom].filter(Boolean).join(" ") || "Sans nom"}</p>
                      <p className="text-xs text-texte-3">{ct.poste}</p>
                    </td>
                    <td className="px-3 py-2.5 text-texte-2">{estDecideur(ct.poste) ? "Décideur marketing" : FONCTIONS[ct.fonction] ?? ct.fonction}</td>
                    <td className="px-3 py-2.5"><Coordonnee contactId={ct.id} champ="email" initiale={ct.email} autorise={ct.origine === "A"} /></td>
                    <td className="px-3 py-2.5"><Coordonnee contactId={ct.id} champ="telephone" initiale={ct.telephone} autorise={ct.origine === "A"} /></td>
                    <td className="px-5 py-2.5">{ct.url_linkedin && <a href={ct.url_linkedin} target="_blank" rel="noopener" className="text-accent-fort hover:underline inline-flex items-center gap-1">Profil <ExternalLink className="w-3 h-3" /></a>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Vide texte="Aucun contact identifié." />}
      </Carte>
    </div>
  );
}
