"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { ApiError, requestPasswordReset } from "@/lib/api";
import { Logo } from "@/components/Logo";

/**
 * F01 (t87u) : demande de reinitialisation. Le message affiche est le meme que le compte
 * existe ou non (anti-enumeration). Canal e-mail uniquement (SMS interdit par le CDC).
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await requestPasswordReset(email.trim());
      setDone(result.message);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 429) {
        setError("Trop de demandes. Patientez une minute avant de reessayer.");
      } else if (cause instanceof ApiError && cause.status === 503) {
        setError("La reinitialisation par e-mail n'est pas encore disponible. Contactez la direction de votre etablissement.");
      } else {
        setError(cause instanceof ApiError ? cause.message : "Demande impossible pour le moment.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <div className="card auth-card stack">
        <div>
          <Logo size={38} tagline="Récupération d'accès" href="/login" />
          <h1 className="h1" style={{ marginTop: 8 }}>
            Mot de passe oublié
          </h1>
          <p className="subtitle">Indiquez l&apos;adresse e-mail de votre compte : nous vous enverrons un lien pour choisir un nouveau mot de passe.</p>
        </div>

        {error ? (
          <p className="alert alert--error" role="alert">
            {error}
          </p>
        ) : null}

        {done ? (
          <p className="alert" role="status">
            {done}
          </p>
        ) : (
          <form className="stack" onSubmit={onSubmit}>
            <label className="field">
              <span className="label">Adresse e-mail</span>
              <input
                className="input"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <button className="btn btn--primary btn--block" type="submit" disabled={busy}>
              {busy ? "Envoi…" : "Envoyer le lien"}
            </button>
          </form>
        )}

        <p className="hint">
          <Link href="/login">Revenir à la connexion</Link>
        </p>
      </div>
    </main>
  );
}