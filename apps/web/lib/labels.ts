import type { AttendanceSlot, AttendanceStatus, Role, SchoolStatus } from "./types";

export function roleLabel(role: Role | string | undefined): string {
  switch (role) {
    case "direction":
      return "Direction";
    case "super_admin":
      return "Super-admin";
    case "teacher":
      return "Enseignant";
    case "parent":
      return "Parent";
    case "student":
      return "Élève";
    case "bus_attendant":
      return "Accompagnateur";
    case "chauffeur":
      return "Chauffeur";
    default:
      return "Profil";
  }
}

export function schoolStatusLabel(status: SchoolStatus | string | null | undefined): string {
  switch (status) {
    case "active":
      return "Actif";
    case "pending":
      return "En attente de validation";
    case "suspended":
      return "Suspendu";
    default:
      return "Non rattaché";
  }
}

export function subscriptionStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case "trial":
      return "Essai";
    case "active":
      return "Actif";
    case "past_due":
      return "Impayé";
    case "expired":
      return "Expiré";
    case "exempt":
      return "Exonéré";
    default:
      return "—";
  }
}

export function formatDate(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Casablanca",
  }).format(date);
}

export const STATUS_LABEL: Record<AttendanceStatus, string> = {
  present: "Présent",
  absent: "Absent",
  late: "Retard",
};

export const SLOT_LABEL: Record<AttendanceSlot, string> = {
  morning: "Matin",
  afternoon: "Après-midi",
};

/** Date civile du jour au Maroc, au format AAAA-MM-JJ. */
export function todayInMorocco(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Casablanca",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Créneau par défaut selon l'heure locale (avant 13 h : matin). */
export function defaultSlot(): AttendanceSlot {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Casablanca", hour: "2-digit", hour12: false }).format(
      new Date(),
    ),
  );
  return hour < 13 ? "morning" : "afternoon";
}

/** Affiche une date civile (AAAA-MM-JJ ou ISO) en toutes lettres. */
export function formatCivilDate(value: string): string {
  const day = value.slice(0, 10);
  const [year, month, date] = day.split("-").map(Number);
  if (!year || !month || !date) {
    return value;
  }
  return new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, date)));
}

export function historyActionLabel(action: string): string {
  switch (action) {
    case "attendance.session.opened":
      return "Appel ouvert";
    case "attendance.rows.recorded":
      return "Présences enregistrées";
    case "attendance.session.closed":
      return "Appel clôturé";
    case "attendance.session.reopened":
      return "Appel rouvert";
    case "student.updated":
      return "Fiche modifiée";
    case "student.massar.changed":
      return "Code Massar modifié";
    case "student.class.changed":
      return "Changement de classe";
    case "student.guardian.linked":
      return "Responsable rattaché";
    case "student.guardian.unlinked":
      return "Responsable détaché";
    case "student.activation_code.issued":
      return "Code d'activation émis";
    case "student.justification.submitted":
      return "Justificatif reçu";
    case "student.justification.accepted":
      return "Justificatif accepté";
    case "student.justification.rejected":
      return "Justificatif refusé";
    case "student.justification.incomplete":
      return "Justificatif à compléter";
    case "student.justification.completed":
      return "Justificatif complété par la famille";
    case "calendar.working_days.updated":
      return "Jours ouvrés modifiés";
    case "calendar.holiday.created":
      return "Période de vacances ajoutée";
    case "calendar.holiday.deleted":
      return "Période de vacances supprimée";
    case "student.parent_action.created":
      return "Demande envoyée aux familles";
    case "student.parent_action.completed":
      return "Demande traitée par la famille";
    case "student.parent_action.cancelled":
      return "Demande annulée";
    case "agenda.created":
      return "Publication";
    case "agenda.updated":
      return "Modification";
    case "agenda.cancelled":
      return "Annulation";
    case "agenda.attachment.added":
      return "Pièce jointe ajoutée";
    case "massar.exported":
      return "Export compatible Massar";
    case "dashboard.exported":
      return "Export du tableau de bord";
    default:
      return action;
  }
}
export const MESSAGE_KIND_LABEL: Record<string, string> = {
  announcement: "Annonce",
  event: "Événement",
  class_message: "Message de classe",
  direct: "Échange individuel",
};

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: "Africa/Casablanca",
  }).format(new Date(value));
}

export const AGENDA_KIND_LABEL: Record<string, string> = {
  homework: "Devoir",
  test: "Contrôle",
  class_event: "Événement de classe",
  important_date: "Date importante",
};

export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Lot 9 : statuts d'abonnement. */
export const SUBSCRIPTION_STATUS_LABEL: Record<string, string> = {
  trial: "Essai",
  active: "Actif",
  past_due: "Paiement en retard",
  suspended: "Suspendu",
  cancelled: "Résilié",
  expired: "Expiré",
  exempt: "Exonéré",
  none: "Sans abonnement",
};

export function formatLimit(value: number | null | undefined): string {
  return value === null || value === undefined ? "À définir" : value.toLocaleString("fr-FR");
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
}
