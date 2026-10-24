import clsx from "clsx";
import { Eye, Linkedin, Mail, MessageSquare, Split, ThumbsUp, UserPlus } from "lucide-react";
import { sequences, type Etape } from "@/lib/donnees";
import { fNombre } from "@/lib/format";
import { Carte, TitreSection, Vide } from "@/components/ui";

export const metadata = { title: "Workflow · Cockpit Hirondo ABX" };

const ACTIONS: Record<string, typeof Eye> = { visite_profil: Eye, invitation: UserPlus, message: MessageSquare, email: Mail, interaction: ThumbsUp };
const STATUTS: Record<string, string> = { brouillon: "Brouillon", validee: "Validée", active: "Active", en_pause: "En pause" };
const lignes = (t: string | null) => (t ?? "").split("\n").filter(Boolean);

function Canal({ canal }: { canal: string }) {
  return canal === "linkedin" ? (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-accent text-white text-[11px] font-medium"><Linkedin className="w-3 h-3" />LinkedIn</span>
  ) : (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-surface-3 text-texte text-[11px] font-medium border border-bord"><Mail className="w-3 h-3" />Email</span>
  );
}

function CarteEtape({ e }: { e: Etape }) {
  const Icone = ACTIONS[e.action] ?? MessageSquare;
  const ab = e.variantes.length > 1;
  return (
    <li className="grid grid-cols-[64px_1fr] gap-3">
      <div className="flex flex-col items-center">
        <span className="chiffres text-xs text-texte-2 whitespace-nowrap">Jour {e.jour}</span>
        <span className={clsx("mt-1.5 w-8 h-8 rounded-full grid place-items-center border", e.canal === "linkedin" ? "bg-accent-pale border-accent/50 text-accent-fort" : "bg-surface-2 border-bord text-texte-2")}>
          <Icone className="w-4 h-4" />
        </span>
        <span className="flex-1 w-px bg-bord mt-1.5" aria-hidden />
      </div>
      <div className="pb-5">
        {e.condition && <p className="text-[11px] text-texte-3 mb-1.5">Si {e.condition.charAt(0).toLowerCase() + e.condition.slice(1)}</p>}
        <div className="rounded-xl border border-bord bg-surface-2 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Canal canal={e.canal} />
            <span className="font-medium text-sm">{e.libelle}</span>
            {ab && <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-accent/15 text-accent-fort text-[11px] font-medium"><Split className="w-3 h-3" />Test A/B</span>}
            <span className="ml-auto text-[11px] text-texte-3">{e.outil}</span>
          </div>
          {e.variantes.length > 0 && (
            <div className={clsx("grid gap-2 mt-3", ab && "sm:grid-cols-2")}>
              {e.variantes.map((v) => (
                <div key={v.lettre} className="rounded-lg border border-bord bg-surface px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded grid place-items-center bg-texte text-surface text-[11px] font-semibold chiffres">{v.lettre}</span>
                    <code className="text-[12px] text-accent-fort">{v.skill}</code>
                    {ab && <span className="ml-auto chiffres text-[11px] text-texte-3">{v.part} %</span>}
                  </div>
                  {v.angle && <p className="text-xs text-texte-2 mt-1.5">{v.angle}</p>}
                  {v.objet && <p className="text-xs mt-1.5"><span className="text-texte-3">Objet </span>{v.objet}</p>}
                  <p className={clsx("text-[11px] mt-1.5", v.corps ? "text-texte-2 whitespace-pre-line line-clamp-4" : "text-texte-3 italic")}>
                    {v.corps ?? "Copie à rédiger avec cette skill"}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

export default async function Workflow() {
  const liste = await sequences();
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-titre text-4xl">Workflow</h1>
        <span className="text-xs text-texte-3">LinkedIn par ReachMCP, email par Brevo · description seulement, rien n'est envoyé d'ici</span>
      </div>
      {liste.length === 0 && <Carte><Vide texte="Aucune séquence dans la configuration." /></Carte>}
      {liste.map((s) => {
        const li = s.etapes.filter((e) => e.canal === "linkedin").length;
        const em = s.etapes.filter((e) => e.canal === "email").length;
        const tests = s.etapes.filter((e) => e.variantes.length > 1).length;
        const duree = Math.max(0, ...s.etapes.map((e) => e.jour));
        return (
          <Carte key={s.code}>
            <TitreSection titre={s.nom} aide={s.objectif ?? undefined}
              droite={<span className="px-2 py-0.5 rounded-md text-xs bg-surface-3 text-texte-2 border border-bord whitespace-nowrap">{STATUTS[s.statut] ?? s.statut}</span>} />
            <div className="px-5 pt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-texte-2">
              <span><span className="text-texte-3">Entrée </span>{s.declencheur}</span>
              <span className="chiffres">{s.etapes.length} étapes sur {duree} jours · {li} LinkedIn, {em} emails · {tests} tests A/B</span>
            </div>
            <div className="grid lg:grid-cols-[1fr_300px] gap-5 p-5">
              <ol className="flex flex-col">{s.etapes.map((e) => <CarteEtape key={e.numero} e={e} />)}</ol>
              <aside className="flex flex-col gap-4 text-sm">
                <div className="rounded-xl border border-bord px-4 py-3">
                  <p className="text-xs text-texte-2">Contacts concernés aujourd'hui</p>
                  <p className="chiffres text-2xl mt-1">{fNombre(s.concernes.contacts)}</p>
                  <p className="text-xs text-texte-3 mt-1 chiffres">{fNombre(s.concernes.email_valide)} avec un email délivrable · {fNombre(s.concernes.linkedin)} avec un profil LinkedIn</p>
                </div>
                <div>
                  <h3 className="text-xs uppercase tracking-wide text-texte-3 mb-2">Sortie de la séquence</h3>
                  <ul className="flex flex-col gap-1.5 text-texte-2">{lignes(s.sortie).map((l) => <li key={l}>{l}</li>)}</ul>
                </div>
              </aside>
            </div>
          </Carte>
        );
      })}
    </div>
  );
}
