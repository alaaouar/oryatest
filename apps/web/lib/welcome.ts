/**
 * t92 (CDC 3.1) : premiere ouverture - choix de la langue et du profil, memorises sur l'appareil
 * (aucune donnee personnelle). Le profil actif du compte reste memorise cote serveur (3.3).
 */
export type WelcomeProfile = "parent" | "student" | "teacher" | "direction" | "bus_attendant" | "chauffeur";
export type WelcomeChoice = { locale: "fr" | "ar"; profile: WelcomeProfile | null };

export const WELCOME_KEY = "orya.welcome.v1";
const LOCALE_KEY = "orya.locale";

export const WELCOME_PROFILES: { role: WelcomeProfile; fr: string; ar: string; activation: boolean }[] = [
  { role: "parent", fr: "Parent", ar: "وليّ الأمر", activation: true },
  { role: "student", fr: "Élève", ar: "تلميذ(ة)", activation: true },
  { role: "teacher", fr: "Enseignant", ar: "أستاذ(ة)", activation: true },
  { role: "direction", fr: "École (direction)", ar: "المدرسة (الإدارة)", activation: false },
  { role: "bus_attendant", fr: "Accompagnateur de bus", ar: "مرافق(ة) الحافلة", activation: true },
  { role: "chauffeur", fr: "Chauffeur de bus", ar: "سائق الحافلة", activation: true },
];

export function readWelcome(): WelcomeChoice | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(WELCOME_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WelcomeChoice>;
    const locale = parsed.locale === "ar" ? "ar" : "fr";
    const profile = WELCOME_PROFILES.some((p) => p.role === parsed.profile) ? (parsed.profile as WelcomeProfile) : null;
    return { locale, profile };
  } catch {
    return null;
  }
}

export function saveWelcome(choice: WelcomeChoice): void {
  window.localStorage.setItem(WELCOME_KEY, JSON.stringify(choice));
  window.localStorage.setItem(LOCALE_KEY, choice.locale);
}

/** Un compte qui se connecte sans etre passe par l'ecran d'accueil ne le revoit pas. */
export function markWelcomeSeen(): void {
  if (typeof window === "undefined" || readWelcome()) return;
  const locale = window.localStorage.getItem(LOCALE_KEY) === "ar" ? "ar" : "fr";
  saveWelcome({ locale, profile: null });
}

export function welcomeProfileLabel(role: WelcomeProfile | null, locale: "fr" | "ar"): string | null {
  const found = WELCOME_PROFILES.find((p) => p.role === role);
  return found ? found[locale] : null;
}
