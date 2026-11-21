"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { ApiError, clearTokens, confirmPasswordReset } from "@/lib/api";
import { Logo } from "@/components/Logo";

/**
 * F01 (t87u) : choix du nouveau mot de passe. Le jeton arrive dans le fragment de l'URL
 * (#token=...) : il n'est envoye ni au serveur web ni en Referer, et il est retire de la
 * barre d'adresse des la lecture. Politique : 12 caracteres, 3 familles (ebe40ca).
 */
function readToken(): string {
  if (typeof window === "undefined") return "";
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  return params.get("token") ?? "";
}

export default function NewPasswordPage() {
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const value = readToken();
    if (value) {
      window.history.replaceState(null, "", window.location.pathname);
    }
    // Lecture unique du fragment au montage (aucun etat externe a synchroniser ensuite).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setToken(value);
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== confirm) {
      setError("Les deux mots de passe ne correspondent pas.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await confirmPasswordReset(token, password);
      clearTokens();
      setDone(true);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Reinitialisation impossible pour le moment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <div className="card auth-card stack">
        <div>
          <Logo size={38} tagline="Sécurité du compte" href="/login" />
          <h1 className="h1" style={{ marginTop: 8 }}>
            Nouveau mot de passe
          </h1>
          <p className="subtitle">Au moins 12 caractères, en mélangeant au moins 3 familles : minuscules, majuscules, chiffres, symboles.</p>
        </div>

        {error ? (
          <p className="alert alert--error" role="alert">
            {error}
          </p>
        ) : null}

        {done ? (
          <div className="stack">
            <p className="alert" role="status">
              Mot de passe modifié. Toutes vos sessions ont été fermées : reconnectez-vous avec votre nouveau mot de passe.
            </p>
            <Link className="btn btn--primary btn--block" href="/login">
              Se connecter
            </Link>
          </div>
        ) : !token ? (
          <p className="alert alert--error" role="alert">
            Lien incomplet. Ouvrez le lien reçu par e-mail, ou faites une nouvelle demande.
          </p>
        ) : (
          <form className="stack" onSubmit={onSubmit}>
            <label className="field">
              <span className="label">Nouveau mot de passe</span>
              <input className="input" type="password" autoComplete="new-password" required maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} />
            </label>
            <label className="field">
              <span className="label">Confirmer le mot de passe</span>
              <input className="input" type="password" autoComplete="new-password" required maxLength={128} value={confirm} onChange={(event) => setConfirm(event.target.value)} />
            </label>
            <button className="btn btn--primary btn--block" type="submit" disabled={busy}>
              {busy ? "Enregistrement…" : "Enregistrer le mot de passe"}
            </button>
          </form>
        )}

        <p className="hint">
          <Link href="/mot-de-passe-oublie">Faire une nouvelle demande</Link>
        </p>
      </div>
    </main>
  );
}