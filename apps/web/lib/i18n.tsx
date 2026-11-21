"use client";

import { useCallback, useEffect, useState } from "react";
import { formatCivilDate, formatDate, formatDateTime, roleLabel } from "./labels";

/**
 * Bloc 4 + t52u C7 : francais / arabe (RTL) pour TOUS les ecrans parent (enfants, justificatifs,
 * demandes, agenda, messages, Mes donnees) et eleve.
 * Les chaines arabes sont une PREMIERE REDACTION, A RELIRE PAR UN ARABOPHONE avant le pilote :
 * elles ne sont PAS validees et ne doivent pas etre presentees comme telles. En mode arabe, chaque
 * ecran affiche la mention `ar_review_note` (data-testid="ar-review-note").
 */
export type Locale = "fr" | "ar";

const FR = {
  lang_switch: "العربية",
  ar_review_note: "",
  loading: "Chargement…",
  parents_only: "Cet espace est réservé aux parents.",
  whole_school: "Toute l'école",
  family_title: "Mes enfants",
  family_subtitle: "Assiduité, justificatifs et demandes de l'école.",
  sections: "Sections",
  tab_children: "Enfants",
  tab_justifications: "Justificatifs",
  tab_actions: "À faire",
  tab_transport: "Transport",
  send_justification: "Envoyer un justificatif",
  child: "Enfant",
  from: "Du",
  to: "Au",
  reason: "Motif",
  send: "Envoyer",
  my_submissions: "Mes envois",
  school_requests: "Demandes de l'école",
  done: "C'est fait",
  done_badge: "Fait",
  file_too_big: "Fichier trop volumineux (5 Mo maximum).",
  justification_sent: "Justificatif envoyé. L'école vous informera de sa décision.",
  action_thanks: "Merci, l'école est informée.",
  no_child: "Aucun enfant n'est encore rattaché à votre compte. Contactez l'établissement.",
  no_classroom: "Classe non attribuée",
  n_absences: "absence(s)",
  n_lates: "retard(s)",
  n_presents: "présent(s)",
  recent_unjustified: "absence(s) ou retard(s) récent(s) sans justificatif accepté.",
  no_attendance: "Aucun appel enregistré pour le moment.",
  justified: "Justifié",
  justify: "Justifier",
  attachment_label: "Pièce jointe (PDF, JPEG ou PNG, 5 Mo maximum, facultative)",
  no_justification: "Aucun justificatif envoyé.",
  school_note: "École :",
  attachment: "Pièce jointe",
  no_request: "Aucune demande en cours.",
  due_before: "avant le",
  slot_morning: "Matin",
  slot_afternoon: "Après-midi",
  bus_today: "Bus aujourd'hui",
  student_title: "Mon espace",
  student_info: "Informations de l'école",
  results: "Résultats",
  result_absent: "Absent(e)",
  student_subtitle: "Consultation seule.",
  agenda: "Agenda",
  agenda_subtitle: "Devoirs, contrôles et dates importantes des classes de vos enfants.",
  period: "Période",
  previous: "← Précédent",
  today: "Aujourd'hui",
  next: "Suivant →",
  back_agenda: "← Agenda",
  nothing_planned: "Rien de prévu sur cette période.",
  n_attachments: "pièce(s) jointe(s)",
  cancelled: "Annulé",
  event: "Événement",
  due_on: "À rendre le ",
  kind_homework: "Devoir",
  kind_test: "Contrôle",
  kind_class_event: "Événement de classe",
  kind_important_date: "Date importante",
  messages_title: "Messages de l'école",
  messages_subtitle: "Annonces, événements, messages de classe et échanges avec l'équipe.",
  filter: "Filtrer",
  all: "Tous",
  to_read: "À lire",
  events: "Événements",
  nothing_to_show: "Rien à afficher.",
  important: "Important",
  ack_requested: "Accusé demandé",
  msg_announcement: "Annonce",
  msg_event: "Événement",
  msg_class_message: "Message de classe",
  msg_direct: "Échange individuel",
  back_messages: "← Messages",
  ack_sent: "Accusé de réception envoyé le",
  ack_button: "J'ai pris connaissance",
  exchange: "Échange",
  no_reply: "Aucune réponse pour l'instant.",
  you: "Vous",
  your_reply: "Votre réponse",
  reply: "Répondre",
  attendance: "Présences",
  justification_status: "Justificatifs (statut)",
  no_data: "Aucune donnée.",
  suspended: "Accès suspendu : un consentement parental actif est requis.",
  my_data: "Mes données",
  md_title: "Mes donnees",
  md_subtitle: "Acces a vos donnees personnelles, rectification et opposition.",
  md_export_sent: "Demande enregistree : l'export sera pret dans quelques minutes, disponible 7 jours.",
  md_deletion_sent: "Demande de suppression enregistree. Votre compte est desactive et vos sessions sont fermees.",
  md_deletion_cancelled: "Suppression annulee.",
  md_rights_sent: "Demande transmise a l'etablissement. Aucune donnee n'est modifiee avant son traitement.",
  md_export_title: "Exporter mes donnees",
  md_export_help: "JSON et PDF, vos seules donnees (pieces jointes non incluses), disponibles 7 jours.",
  md_export_button: "Demander un export",
  md_until: "jusqu'au",
  md_rights_title: "Rectification ou opposition",
  md_kind: "Type de demande",
  md_rectification: "Rectification",
  md_opposition: "Opposition",
  md_subject: "Objet",
  md_message: "Message a l'etablissement",
  md_send: "Envoyer la demande",
  md_response: "reponse :",
  md_delete_title: "Supprimer mon compte",
  md_delete_help:
    "Suppression definitive apres un delai de securite, annulable pendant ce delai. Confirmez avec votre mot de passe (et votre code MFA si votre compte en a un).",
  md_delete_requested: "Demande enregistree : vous allez etre deconnecte.",
  md_delete_scheduled: "Suppression programmee",
  md_on: "le",
  md_cancel_delete: "Annuler la suppression",
  md_password: "Mot de passe",
  md_mfa: "Code MFA (si active)",
  md_delete_button: "Demander la suppression de mon compte",
  md_pw_title: "Changer mon mot de passe",
  md_pw_help: "12 caracteres minimum, au moins 3 familles (minuscules, majuscules, chiffres, symboles). Vos autres sessions seront fermees.",
  md_pw_current: "Mot de passe actuel",
  md_pw_new: "Nouveau mot de passe",
  md_pw_confirm: "Confirmer le nouveau mot de passe",
  md_pw_mismatch: "Les deux nouveaux mots de passe ne correspondent pas.",
  md_pw_button: "Changer le mot de passe",
  md_pw_done: "Mot de passe change. Autres sessions fermees :",
  bus_not_planned: "Pas de transport prévu",
  bus_waiting: "En attente du bus",
  bus_on_board: "Dans le bus",
  bus_dropped_off: "Déposé",
  bus_absent: "Absent du bus",
  st_present: "Présent",
  st_absent: "Absent",
  st_late: "En retard",
  j_pending: "En attente",
  j_accepted: "Accepté",
  j_rejected: "Refusé",
  j_incomplete: "À compléter",
  complete_title: "Compléter ce justificatif",
  complete_reason: "Précision pour l'école (facultatif si vous joignez une pièce)",
  complete_send: "Envoyer le complément",
  complete_sent: "Complément envoyé : le justificatif est de nouveau en attente.",
  complete_need: "Ajoutez une précision ou une pièce.",
  card_via_justification: "Complétez le justificatif (onglet Justificatifs) : cette demande se fermera automatiquement.",
  hidden_actions: "Autres demandes en attente, affichées dès que celles-ci sont traitées :",
} as const;

export type MessageKey = keyof typeof FR;

/** PREMIERE REDACTION - a relire par un arabophone (non validee). */
const AR: Record<MessageKey, string> = {
  lang_switch: "Français",
  ar_review_note: "ترجمة أولية غير معتمدة - à relire par un arabophone",
  loading: "جارٍ التحميل…",
  parents_only: "هذا الفضاء مخصص لأولياء الأمور.",
  whole_school: "المدرسة كلها",
  family_title: "أطفالي",
  family_subtitle: "المواظبة والمبررات وطلبات المدرسة.",
  sections: "الأقسام",
  tab_children: "الأطفال",
  tab_justifications: "المبررات",
  tab_actions: "مهام",
  tab_transport: "النقل المدرسي",
  send_justification: "إرسال مبرر",
  child: "الطفل",
  from: "من",
  to: "إلى",
  reason: "السبب",
  send: "إرسال",
  my_submissions: "إرسالاتي",
  school_requests: "طلبات المدرسة",
  done: "تم",
  done_badge: "مُنجَز",
  file_too_big: "الملف كبير جدًا (5 ميغابايت كحد أقصى).",
  justification_sent: "تم إرسال المبرر. ستُعلمكم المدرسة بقرارها.",
  action_thanks: "شكرًا، تم إعلام المدرسة.",
  no_child: "لا يوجد أي طفل مرتبط بحسابكم بعد. يُرجى الاتصال بالمؤسسة.",
  no_classroom: "لم يُحدَّد القسم",
  n_absences: "غياب",
  n_lates: "تأخر",
  n_presents: "حضور",
  recent_unjustified: "غياب أو تأخر حديث دون مبرر مقبول.",
  no_attendance: "لم يُسجَّل أي نداء حتى الآن.",
  justified: "مُبرَّر",
  justify: "تبرير",
  attachment_label: "مرفق (PDF أو JPEG أو PNG، 5 ميغابايت كحد أقصى، اختياري)",
  no_justification: "لم يُرسَل أي مبرر.",
  school_note: "المدرسة:",
  attachment: "المرفق",
  no_request: "لا توجد طلبات جارية.",
  due_before: "قبل",
  slot_morning: "الصباح",
  slot_afternoon: "بعد الزوال",
  bus_today: "الحافلة اليوم",
  student_title: "فضائي",
  student_info: "معلومات من المدرسة",
  results: "النتائج",
  result_absent: "غائب(ة)",
  student_subtitle: "للاطلاع فقط.",
  agenda: "المفكرة",
  agenda_subtitle: "الواجبات والفروض والتواريخ المهمة لأقسام أطفالكم.",
  period: "الفترة",
  previous: "→ السابق",
  today: "اليوم",
  next: "التالي ←",
  back_agenda: "→ المفكرة",
  nothing_planned: "لا شيء مبرمج في هذه الفترة.",
  n_attachments: "مرفق(ات)",
  cancelled: "مُلغى",
  event: "حدث",
  due_on: "يُسلَّم يوم ",
  kind_homework: "واجب",
  kind_test: "فرض",
  kind_class_event: "حدث القسم",
  kind_important_date: "تاريخ مهم",
  messages_title: "رسائل المدرسة",
  messages_subtitle: "إعلانات وأحداث ورسائل القسم وتبادلات مع الفريق.",
  filter: "تصفية",
  all: "الكل",
  to_read: "للقراءة",
  events: "الأحداث",
  nothing_to_show: "لا شيء للعرض.",
  important: "مهم",
  ack_requested: "إشعار بالاطلاع مطلوب",
  msg_announcement: "إعلان",
  msg_event: "حدث",
  msg_class_message: "رسالة القسم",
  msg_direct: "تبادل فردي",
  back_messages: "→ الرسائل",
  ack_sent: "أُرسل الإشعار بالاطلاع يوم",
  ack_button: "اطلعتُ على الرسالة",
  exchange: "التبادل",
  no_reply: "لا يوجد رد حتى الآن.",
  you: "أنتم",
  your_reply: "ردكم",
  reply: "الرد",
  attendance: "الحضور",
  justification_status: "المبررات (الحالة)",
  no_data: "لا توجد بيانات.",
  suspended: "الولوج موقوف: يلزم موافقة سارية من ولي الأمر.",
  my_data: "بياناتي",
  md_title: "بياناتي",
  md_subtitle: "الولوج إلى بياناتكم الشخصية، والتصحيح والاعتراض.",
  md_export_sent: "تم تسجيل الطلب: سيكون التصدير جاهزًا خلال دقائق، ومتاحًا لمدة 7 أيام.",
  md_deletion_sent: "تم تسجيل طلب الحذف. تم تعطيل حسابكم وإغلاق جلساتكم.",
  md_deletion_cancelled: "تم إلغاء الحذف.",
  md_rights_sent: "تم إرسال الطلب إلى المؤسسة. لن تُعدَّل أي بيانات قبل معالجته.",
  md_export_title: "تصدير بياناتي",
  md_export_help: "بصيغتي JSON وPDF، بياناتكم فقط (دون المرفقات)، متاحة لمدة 7 أيام.",
  md_export_button: "طلب تصدير",
  md_until: "إلى غاية",
  md_rights_title: "التصحيح أو الاعتراض",
  md_kind: "نوع الطلب",
  md_rectification: "تصحيح",
  md_opposition: "اعتراض",
  md_subject: "الموضوع",
  md_message: "رسالة إلى المؤسسة",
  md_send: "إرسال الطلب",
  md_response: "الرد:",
  md_delete_title: "حذف حسابي",
  md_delete_help: "حذف نهائي بعد مهلة أمان، يمكن إلغاؤه خلال هذه المهلة. أكّدوا بكلمة المرور (وبرمز التحقق الثنائي إن كان مفعّلًا في حسابكم).",
  md_delete_requested: "تم تسجيل الطلب: سيتم تسجيل خروجكم.",
  md_delete_scheduled: "الحذف مبرمج",
  md_on: "يوم",
  md_cancel_delete: "إلغاء الحذف",
  md_password: "كلمة المرور",
  md_mfa: "رمز التحقق الثنائي (إن كان مفعّلًا)",
  md_delete_button: "طلب حذف حسابي",
  md_pw_title: "تغيير كلمة المرور",
  md_pw_help: "12 حرفًا على الأقل، و3 أنواع على الأقل (حروف صغيرة، حروف كبيرة، أرقام، رموز). سيتم إغلاق جلساتكم الأخرى.",
  md_pw_current: "كلمة المرور الحالية",
  md_pw_new: "كلمة المرور الجديدة",
  md_pw_confirm: "تأكيد كلمة المرور الجديدة",
  md_pw_mismatch: "كلمتا المرور الجديدتان غير متطابقتين.",
  md_pw_button: "تغيير كلمة المرور",
  md_pw_done: "تم تغيير كلمة المرور. الجلسات الأخرى المغلقة:",
  bus_not_planned: "لا يوجد نقل مبرمج",
  bus_waiting: "في انتظار الحافلة",
  bus_on_board: "في الحافلة",
  bus_dropped_off: "تم الإنزال",
  bus_absent: "غائب عن الحافلة",
  st_present: "حاضر",
  st_absent: "غائب",
  st_late: "متأخر",
  j_pending: "قيد الانتظار",
  j_accepted: "مقبول",
  j_rejected: "مرفوض",
  j_incomplete: "يحتاج إلى إكمال",
  complete_title: "إكمال هذا التبرير",
  complete_reason: "توضيح للمدرسة (اختياري إذا أرفقت وثيقة)",
  complete_send: "إرسال الإكمال",
  complete_sent: "تم إرسال الإكمال: التبرير قيد الانتظار من جديد.",
  complete_need: "أضف توضيحًا أو وثيقة.",
  card_via_justification: "أكمل التبرير (تبويب التبريرات): سيُغلق هذا الطلب تلقائيًا.",
  hidden_actions: "طلبات أخرى في الانتظار، تظهر بعد معالجة هذه الطلبات:",
};

/** Codes techniques (statuts d'export, de demandes, roles) : arabe si connu, sinon code / libelle FR inchange. */
const AR_CODES: Record<string, string> = {
  pending: "قيد الانتظار",
  processing: "قيد المعالجة",
  ready: "جاهز",
  failed: "فشل",
  expired: "منتهي الصلاحية",
  open: "مفتوح",
  in_progress: "قيد المعالجة",
  answered: "تمت الإجابة",
  closed: "مغلق",
  rejected: "مرفوض",
  rectification: "تصحيح",
  opposition: "اعتراض",
};
const AR_ROLES: Record<string, string> = {
  direction: "الإدارة",
  teacher: "الأستاذ(ة)",
  parent: "ولي الأمر",
  bus_attendant: "المرافق(ة)",
  chauffeur: "سائق الحافلة",
  super_admin: "المشرف العام",
  student: "التلميذ(ة)",
};

export function translate(locale: Locale, key: MessageKey): string {
  return locale === "ar" ? AR[key] : FR[key];
}

/** Traduit une cle construite (`kind_${x}`) ; si elle n'existe pas, renvoie `fallback`. */
export function translateDynamic(locale: Locale, key: string, fallback: string): string {
  const dict: Record<string, string> = locale === "ar" ? AR : FR;
  return key in dict ? dict[key] : fallback;
}

export function codeLabel(locale: Locale, code: string): string {
  return locale === "ar" ? (AR_CODES[code] ?? code) : code;
}

export function roleText(locale: Locale, role: string | undefined): string {
  return locale === "ar" && role && AR_ROLES[role] ? AR_ROLES[role] : roleLabel(role);
}

export function civilDate(locale: Locale, value: string): string {
  if (locale !== "ar") return formatCivilDate(value);
  const [year, month, date] = value.slice(0, 10).split("-").map(Number);
  if (!year || !month || !date) return value;
  return new Intl.DateTimeFormat("ar-MA", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, date)),
  );
}

export function dateShort(locale: Locale, value: string | null | undefined): string {
  if (locale !== "ar") return formatDate(value);
  if (!value || Number.isNaN(new Date(value).getTime())) return "-";
  return new Intl.DateTimeFormat("ar-MA", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Casablanca" }).format(new Date(value));
}

export function dateTime(locale: Locale, value: string | null | undefined): string {
  if (locale !== "ar") return formatDateTime(value);
  if (!value) return "-";
  return new Intl.DateTimeFormat("ar-MA", { dateStyle: "full", timeStyle: "short", timeZone: "Africa/Casablanca" }).format(new Date(value));
}

const STORAGE_KEY = "orya.locale";

export function useI18n() {
  const [locale, setLocaleState] = useState<Locale>("fr");
  useEffect(() => {
    const saved = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
    if (saved === "ar" || saved === "fr") setLocaleState(saved);
  }, []);
  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  }, []);
  const t = useCallback((key: MessageKey) => translate(locale, key), [locale]);
  return { locale, setLocale, t, dir: (locale === "ar" ? "rtl" : "ltr") as "rtl" | "ltr" };
}

export function LocaleSwitch({
  locale,
  setLocale,
  label,
  className,
}: {
  locale: Locale;
  setLocale: (l: Locale) => void;
  label?: string;
  className?: string;
}) {
  return (
    <div className={`stack locale-switch${className ? ` ${className}` : ""}`}>
      <button
        type="button"
        className="btn btn--outline locale-switch__button"
        data-testid="locale-switch"
        lang={locale === "ar" ? "fr" : "ar"}
        onClick={() => setLocale(locale === "ar" ? "fr" : "ar")}
      >
        <span style={{ marginRight: 4 }}>🌐</span>
        {label ?? (locale === "ar" ? "Français" : "العربية")}
      </button>
      {locale === "ar" ? (
        <small className="muted locale-switch__note" data-testid="ar-review-note">
          {AR.ar_review_note}
        </small>
      ) : null}
    </div>
  );
}
