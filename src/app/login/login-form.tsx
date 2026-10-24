"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Lock } from "lucide-react";

export function LoginForm() {
  const params = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError("");
    try {
      const res = await fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
      if (res.ok) {
        const next = params.get("next") || "/";
        window.location.assign(next.startsWith("/") && !next.startsWith("//") ? next : "/");
        return;
      }
      setError("Mot de passe incorrect. Vérifiez-le et réessayez.");
    } catch {
      setError("Problème de connexion. Réessayez dans un instant.");
    }
    setPending(false);
  };

  return (
    <form onSubmit={submit} className="mt-5 flex flex-col gap-3">
      <label htmlFor="mot-de-passe" className="text-sm font-medium">
        Mot de passe
      </label>
      <div className="relative">
        <Lock className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-texte-3" />
        <input
          id="mot-de-passe"
          type="password"
          autoComplete="current-password"
          autoFocus
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full pl-8 pr-3 py-2 rounded-md border border-bord bg-surface-2 text-sm"
        />
      </div>
      {error && <p className="text-sm text-alerte">{error}</p>}
      <button type="submit" disabled={pending || !password} className="w-full py-2 rounded-md bg-accent text-white text-sm font-semibold hover:bg-accent-fort disabled:opacity-60">
        {pending ? "Vérification…" : "Ouvrir le tableau de bord"}
      </button>
    </form>
  );
}
