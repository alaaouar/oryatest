"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { ApiError, enrollMfa, login, saveSession, verifyMfa } from "@/lib/api";
import { isLoginSuccess, type MfaEnrollment } from "@/lib/types";
import { markWelcomeSeen, readWelcome, WELCOME_PROFILES, welcomeProfileLabel, type WelcomeChoice } from "@/lib/welcome";
import { Logo } from "@/components/Logo";

type Step =
  | { kind: "credentials" }
  | { kind: "enroll"; challenge: string; enrollment: MfaEnrollment }
  | { kind: "verify"; challenge: string };

async function generateCurrentTotp(base32Secret: string): Promise<string> {
  const base32chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = base32Secret.toUpperCase().replace(/[\s=]/g, "");
  let bits = "";
  for (let i = 0; i < clean.length; i++) {
    const val = base32chars.indexOf(clean.charAt(i));
    if (val >= 0) bits += val.toString(2).padStart(5, "0");
  }
  const bytes = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(bits.substring(i * 8, (i + 1) * 8), 2);
  }

  const epoch = Math.floor(Date.now() / 30000);
  const timeBuffer = new ArrayBuffer(8);
  const timeView = new DataView(timeBuffer);
  timeView.setUint32(4, epoch, false);

  const key = await window.crypto.subtle.importKey(
    "raw",
    bytes,
    { name: "HMAC", hash: { name: "SHA-1" } },
    false,
    ["sign"],
  );
  const signature = await window.crypto.subtle.sign("HMAC", key, timeBuffer);
  const hmac = new Uint8Array(signature);
  const offset = hmac[hmac.length - 1] & 0x0f;
  const codeInt =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (codeInt % 1000000).toString().padStart(6, "0");
}

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>({ kind: "credentials" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // t92 (CDC 3.1) : profil choisi a la premiere ouverture (memorise sur l'appareil).
  const [welcome, setWelcome] = useState<WelcomeChoice | null>(null);
  useEffect(() => {
    setWelcome(readWelcome());
  }, []);

  function openConsole(csrfToken: string) {
    saveSession({ csrfToken });
    markWelcomeSeen();
    router.replace("/dashboard");
  }

  async function onSubmitCredentials(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const result = await login(email.trim(), password);

      if (isLoginSuccess(result)) {
        openConsole(result.csrfToken);
        return;
      }

      if (result.method === "enroll") {
        const enrollment = await enrollMfa(result.challengeToken);
        setStep({ kind: "enroll", challenge: result.challengeToken, enrollment });
      } else {
        setStep({ kind: "verify", challenge: result.challengeToken });
      }
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Connexion impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function onSubmitCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (step.kind === "credentials") {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const tokens = await verifyMfa(step.challenge, code.trim());
      openConsole(tokens.csrfToken);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Code refusé.");
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <div className="card auth-card stack" style={{ padding: "36px 32px", borderRadius: 8 }}>
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Logo size={42} tagline="Plateforme scolaire & familles" href="/" />
          </div>
          <h1 className="h1" style={{ marginTop: 16, fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em" }}>
            {step.kind === "credentials" ? "Connectez-vous à votre espace" : "Vérification en deux étapes"}
          </h1>
          <p className="subtitle" style={{ fontSize: 14 }}>
            {step.kind === "credentials"
              ? "Console d'établissement réservée à la direction, aux super-administrateurs et aux équipes pédagogiques."
              : "Cette console exige un second facteur pour les comptes de direction et super-admin."}
          </p>
        </div>

        {error ? (
          <p className="alert alert--error" role="alert">
            {error}
          </p>
        ) : null}

        {step.kind === "credentials" && welcome?.profile ? (
          <p className="muted" data-testid="welcome-choice">
            Profil choisi : <strong lang={welcome.locale}>{welcomeProfileLabel(welcome.profile, welcome.locale)}</strong> ·{" "}
            <a href="/bienvenue">Changer</a>
            {WELCOME_PROFILES.find((p) => p.role === welcome.profile)?.activation ? (
              <>
                {" "}· Première connexion ? <a href="/activation">Activer mon compte</a>
              </>
            ) : null}
          </p>
        ) : null}
        {step.kind === "credentials" ? (
          <form className="stack" onSubmit={onSubmitCredentials}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
              <button
                type="button"
                className="btn btn--outline"
                style={{ fontSize: 12, padding: "4px 10px", minHeight: 30 }}
                onClick={() => {
                  setEmail(process.env.NEXT_PUBLIC_SUPERADMIN_EMAIL || "superadmin@orya.test");
                  setPassword(process.env.NEXT_PUBLIC_SUPERADMIN_PASSWORD || "WG1VxucCSrTkkFOE");
                }}
              >
                🛡️ Super-admin ORYA (.env)
              </button>
              <button
                type="button"
                className="btn btn--outline"
                style={{ fontSize: 12, padding: "4px 10px", minHeight: 30 }}
                onClick={() => {
                  setEmail("direction@atlas.orya.test");
                  setPassword("WG1VxucCSrTkkFOE");
                }}
              >
                🏫 Direction (Lycée Atlas)
              </button>
            </div>

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

            <label className="field">
              <span className="label">Mot de passe</span>
              <input
                className="input"
                type="password"
                autoComplete="current-password"
                required
                minLength={8}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>

            <a className="muted" href="/mot-de-passe-oublie">
              Mot de passe oublié ?
            </a>

            <button className="btn btn--primary btn--block" type="submit" disabled={busy}>
              {busy ? "Connexion…" : "Se connecter"}
            </button>
          </form>
        ) : (
          <form className="stack" onSubmit={onSubmitCode}>
            {step.kind === "enroll" ? (
              <div className="stack" style={{ gap: 8 }}>
                <p className="muted">
                  Scannez ce code dans Google Authenticator ou saisissez la clé manuellement.
                </p>
                <p className="mono" style={{ wordBreak: "break-all" }}>
                  {step.enrollment.secret}
                </p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="btn btn--teal"
                    style={{ fontSize: 12, padding: "6px 12px", minHeight: 32 }}
                    onClick={async () => {
                      try {
                        const totp = await generateCurrentTotp(step.enrollment.secret);
                        setCode(totp);
                      } catch {
                        setCode("123456");
                      }
                    }}
                  >
                    ⚡ Remplir le code TOTP actuel
                  </button>
                  <a className="btn btn--outline" style={{ fontSize: 12, padding: "6px 12px", minHeight: 32 }} href={step.enrollment.otpauthUrl}>
                    Ouvrir l&apos;app d&apos;authentification
                  </a>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  className="btn btn--teal"
                  style={{ fontSize: 12, padding: "4px 10px", minHeight: 28 }}
                  onClick={() => setCode("123456")}
                >
                  ⚡ Code rapide (123456)
                </button>
              </div>
            )}

            <label className="field">
              <span className="label">Code à 6 chiffres</span>
              <input
                className="input"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                autoComplete="one-time-code"
                required
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
              />
            </label>

            <button className="btn btn--primary btn--block" type="submit" disabled={busy || code.length !== 6}>
              {busy ? "Vérification…" : "Valider le code"}
            </button>

            <button
              className="btn btn--ghost btn--block"
              type="button"
              onClick={() => {
                setStep({ kind: "credentials" });
                setCode("");
                setError(null);
              }}
            >
              Revenir à la connexion
            </button>
          </form>
        )}

        <p className="hint">
          Accès réservé aux comptes activés. Un établissement en attente de validation par ORYA
          ne peut pas se connecter.
        </p>
      </div>
    </main>
  );
}
