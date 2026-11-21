export const demoSchool = {
  name: "Groupe scolaire Al Nour",
  city: "Casablanca",
  disclaimer:
    "Établissement et chiffres fictifs, uniquement pour la démonstration. Aucune donnée réelle d'élève n'est utilisée.",
} as const;

export const kpis = [
  {
    id: "eleves",
    label: "Élèves",
    value: "342",
    detail: "Tous cycles — donnée fictive",
  },
  {
    id: "enseignants",
    label: "Enseignants",
    value: "28",
    detail: "Personnel pédagogique — donnée fictive",
  },
  {
    id: "absences",
    label: "Absences du jour",
    value: "7",
    detail: "Sur la journée en cours — donnée fictive",
  },
  {
    id: "retards",
    label: "Retards",
    value: "4",
    detail: "Signalés ce matin — donnée fictive",
  },
] as const;

export const todayEvents = [
  {
    id: "1",
    title: "Absence — Élève démo 14",
    meta: "4ᵉ A · justificatif en attente",
  },
  {
    id: "2",
    title: "Retard — Élève démo 08",
    meta: "2ᵉ collège B · arrivée 08:17",
  },
  {
    id: "3",
    title: "Message famille — non envoyé",
    meta: "La communication n'est pas encore branchée",
  },
] as const;

export const navItems = [
  { href: "/", label: "Accueil" },
  { href: "/presences", label: "Présences" },
  { href: "/eleves", label: "Élèves" },
  { href: "/enseignants", label: "Enseignants" },
  { href: "/communication", label: "Communication" },
  { href: "/agenda", label: "Agenda" },
  { href: "/parametres", label: "Paramètres" },
] as const;
