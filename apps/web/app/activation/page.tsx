"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { acceptInvitation, activateParent, describeError, saveSession } from "@/lib/api";
import { Logo } from "@/components/Logo";

/** Lot 3 : activation du compte famille (lien d'invitation ou code remis par l'école). */
export default function ActivationPage() {
  return (
    <Suspense fallback={null}>
      <ActivationForm />
    </Suspense>
  );
}

function ActivationForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const mode: "invitation" | "code" = token ? "invitation" : "code";

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [schoolCode, setSchoolCode] = useState("");
  const [activationCode, setActivationCode] = useState("");
  const [relationship, setRelationship] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password.length < 8) {
      setError("Le mot de passe doit contenir au moins 8 caractères.");
      return;
    }
    if (password !== confirm) {
      setError("Les deux mots de passe ne correspondent pas.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const session =
        mode === "invitation"
          ? await acceptInvitation({ token, password, fullName: fullName.trim() || undefined })
          : await activateParent({
              schoolCode: schoolCode.trim().toUpperCase(),
              activationCode: activationCode.trim(),
              email: email.trim(),
              password,
              fullName: fullName.trim(),
              relationship: relationship.trim() || undefined,
            });
      saveSession(session);
      router.replace("/family");
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <form className="auth-card card stack" onSubmit={(event) => void onSubmit(event)}>
        <Logo size={38} tagline="Activation de compte" href="/" />
        <h1 className="h2">Activer mon compte famille</h1>
        <p className="muted">
          {mode === "invitation"
            ? "Choisissez votre mot de passe pour accéder au suivi de vos enfants."
            : "Saisissez le code établissement et le code d'activation remis par l'école."}
        </p>

        {mode === "code" ? (
          <>
            <div className="field">
              <label className="label" htmlFor="school">
                Code établissement
              </label>
              <input id="school" className="input mono" value={schoolCode} onChange={(e) => setSchoolCode(e.target.value)} maxLength={6} required />
            </div>
            <div className="field">
              <label className="label" htmlFor="code">
                Code d&apos;activation
              </label>
              <input id="code" className="input mono" value={activationCode} onChange={(e) => setActivationCode(e.target.value)} required />
            </div>
            <div className="field">
              <label className="label" htmlFor="email">
                E-mail
              </label>
              <input id="email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
            </div>
            <div className="field">
              <label className="label" htmlFor="rel">
                Lien avec l&apos;élève
              </label>
              <input id="rel" className="input" value={relationship} onChange={(e) => setRelationship(e.target.value)} />
            </div>
          </>
        ) : null}

        <div className="field">
          <label className="label" htmlFor="name">
            Nom complet
          </label>
          <input id="name" className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} required={mode === "code"} />
        </div>
        <div className="field">
          <label className="label" htmlFor="password">
            Mot de passe
          </label>
          <input id="password" type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required />
        </div>
        <div className="field">
          <label className="label" htmlFor="confirm">
            Confirmer le mot de passe
          </label>
          <input id="confirm" type="password" className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
        </div>

        {error ? <div className="alert alert--error">{error}</div> : null}
        <button className="btn btn--primary btn--block" type="submit" disabled={busy}>
          Activer
        </button>
        <Link href="/login">J&apos;ai déjà un compte</Link>
      </form>
    </main>
  );
}
