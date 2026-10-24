import { Suspense } from "react";
import { LoginForm } from "./login-form";

export const metadata = { title: "Connexion · Cockpit Hirondo ABX" };

export default function LoginPage() {
  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-[380px] bg-surface border border-bord rounded-xl px-6 py-7">
        <div className="flex items-center gap-2">
          <span className="w-8 h-8 rounded-full bg-accent text-white grid place-items-center font-titre text-lg">H</span>
          <span className="etiquette">Hirondo · machine à leads</span>
        </div>
        <h1 className="font-titre text-3xl mt-6">Connexion</h1>
        <p className="text-sm text-texte-2 mt-1">Saisissez le mot de passe reçu pour ouvrir le tableau de bord.</p>
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
