"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { readWelcome, saveWelcome, WELCOME_PROFILES, type WelcomeProfile } from "@/lib/welcome";
import { Logo } from "@/components/Logo";

const TEXT = {
  fr: {
    title: "Bienvenue sur ORYA",
    language: "Choisissez votre langue",
    profile: "Vous êtes :",
    note: "Ce choix est mémorisé sur cet appareil. Vous pourrez le changer depuis l'écran de connexion.",
  },
  ar: {
    title: "مرحبا بك في ORYA",
    language: "اختر لغتك",
    profile: "أنت :",
    note: "يُحفظ هذا الاختيار على هذا الجهاز. يمكنك تغييره من صفحة تسجيل الدخول.",
  },
} as const;

/** t92 (CDC 3.1) : première ouverture - langue (FR / AR) puis l'un des 5 profils. */
export default function WelcomePage() {
  const router = useRouter();
  const [locale, setLocale] = useState<"fr" | "ar">("fr");

  useEffect(() => {
    const saved = readWelcome();
    if (saved) setLocale(saved.locale);
  }, []);

  function choose(profile: WelcomeProfile) {
    saveWelcome({ locale, profile });
    router.replace("/login");
  }

  const t = TEXT[locale];
  return (
    <main className="auth-shell" dir={locale === "ar" ? "rtl" : "ltr"} lang={locale}>
      <div className="auth-card stack" data-testid="welcome">
        <div style={{ marginBottom: 4 }}>
          <Logo size={44} tagline="L'école et la famille, au même endroit" href={null} />
        </div>
        <h1 className="h1">{t.title}</h1>
        <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="label">{t.language}</legend>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className={`btn ${locale === "fr" ? "btn--primary" : "btn--ghost"}`} aria-pressed={locale === "fr"} lang="fr" onClick={() => setLocale("fr")}>
              Français
            </button>
            <button type="button" className={`btn ${locale === "ar" ? "btn--primary" : "btn--ghost"}`} aria-pressed={locale === "ar"} lang="ar" onClick={() => setLocale("ar")}>
              العربية
            </button>
          </div>
        </fieldset>
        <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="label">{t.profile}</legend>
          <div className="stack" style={{ gap: 8 }} data-testid="welcome-profiles">
            {WELCOME_PROFILES.map((p) => (
              <button key={p.role} type="button" className="btn btn--block" data-role={p.role} onClick={() => choose(p.role)}>
                {p[locale]}
              </button>
            ))}
          </div>
        </fieldset>
        <p className="hint">{t.note}</p>
      </div>
    </main>
  );
}
