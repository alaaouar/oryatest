export type Role =
  | "direction"
  | "super_admin"
  | "parent"
  | "teacher"
  | "student"
  | "bus_attendant"
  | "chauffeur";

export type SchoolStatus = "pending" | "active" | "suspended";

export type Profile = {
  id: string;
  role: Role;
  schoolId: string | null;
  schoolName: string | null;
  schoolStatus: SchoolStatus | null;
  displayName: string;
};

export type MeResponse = {
  user: {
    id: string;
    email: string;
    locale: string;
    status: string;
    mfaEnabled: boolean;
    createdAt: string;
  };
  activeProfileId: string;
  profiles: Profile[];
};

export type LoginSuccess = {
  /** Lot 10 : jetons en cookies httpOnly ; le corps ne porte que le jeton CSRF. */
  cookieSession: true;
  csrfToken: string;
  expiresIn: number;
  profile: Profile;
};

export type LoginChallenge = {
  mfaRequired: true;
  method: "enroll" | "verify";
  challengeToken: string;
};

export type LoginResponse = LoginSuccess | LoginChallenge;

export type MfaEnrollment = {
  secret: string;
  otpauthUrl: string;
};

export type SchoolAdminInfo = {
  id: string;
  displayName: string;
  role: Role;
  createdAt: string;
  user: {
    id: string;
    email: string;
    status: string;
    lastLoginAt: string | null;
  };
};

export type SchoolRow = {
  id: string;
  name: string;
  city: string;
  ice?: string | null;
  code: string;
  status: SchoolStatus;
  createdAt: string;
  subscription: {
    status: string;
    pricePerChildMad: number;
    trialEndsAt: string | null;
  } | null;
  profiles?: SchoolAdminInfo[];
};

export type AuditRow = {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  severity: string;
  schoolId: string | null;
  createdAt: string;
};

export function isLoginSuccess(value: LoginResponse): value is LoginSuccess {
  return "csrfToken" in value;
}

/* --- Lot 2.3 : présences ------------------------------------------------- */

export type AttendanceStatus = "present" | "absent" | "late";
export type AttendanceSlot = "morning" | "afternoon";
export type SessionStatus = "open" | "closed";

export type ClassroomTeacher = {
  assignmentId: string;
  profileId: string;
  displayName: string;
};

export type ClassroomRow = {
  id: string;
  name: string;
  cycle: string | null;
  level: string | null;
  studentCount: number;
  teachers: ClassroomTeacher[];
};

export type ClassroomsResponse = {
  schoolYear: string;
  classrooms: ClassroomRow[];
};

export type TeacherRow = {
  id: string;
  displayName: string;
  createdAt: string;
  assignmentCount: number;
};

export type AssignmentRow = {
  id: string;
  schoolYear: string;
  classroomId: string;
  teacherProfileId: string;
  createdAt: string;
  classroom: { id: string; name: string };
  teacherProfile: { id: string; displayName: string; role: Role };
};

export type SessionSummary = {
  id: string;
  slot: AttendanceSlot;
  status: SessionStatus;
  version: number;
  closedAt: string | null;
  reopenedAt: string | null;
  reopenReason: string | null;
  createdAt: string;
  markedCount: number;
};

export type SessionRow = {
  id: string;
  studentId: string;
  status: AttendanceStatus;
  recordedAt: string;
  version: number;
  student: { studentCode: string; displayName: string };
};

export type SessionDetail = {
  id: string;
  classroomId: string;
  date: string;
  slot: AttendanceSlot;
  status: SessionStatus;
  schoolYear: string;
  version: number;
  closedAt: string | null;
  reopenedAt: string | null;
  reopenReason: string | null;
  createdAt: string;
  classroom: { id: string; name: string };
  rows: SessionRow[];
};

export type RosterStudent = {
  id: string;
  studentCode: string;
  displayName: string;
};

export type RosterResponse = {
  classroomId: string;
  date: string;
  schoolYear: string;
  students: RosterStudent[];
};

export type MarkResult = {
  accepted: number;
  rejected: { studentId: string; message: string }[];
  changed: number;
};

export type HistoryChange = {
  studentId: string;
  from: AttendanceStatus | null;
  to: AttendanceStatus;
  studentName: string | null;
  studentCode: string | null;
};

export type HistoryEntry = {
  id: string;
  action: string;
  severity: string;
  createdAt: string;
  actor: { displayName: string; role: Role } | null;
  reason: string | null;
  accepted: number | null;
  changes: HistoryChange[];
};
/* --- Lot 3 : élèves et familles ------------------------------------------ */

export type ClassroomRef = { id: string; name: string; level?: string | null; cycle?: string | null };

export type StudentListRow = {
  id: string;
  studentCode: string;
  displayName: string;
  massarCode: string | null;
  birthDate: string | null;
  classroom: ClassroomRef | null;
  guardianCount: number;
};

export type AttendanceSummary = { present: number; absent: number; late: number };

export type StudentGuardianLink = {
  id: string;
  fullName: string;
  relationship: string | null;
  isPrimary: boolean;
  hasAccount: boolean;
  email: string | null;
  phone: string | null;
  phoneSecondary: string | null;
  address: string | null;
};

export type StudentHistoryEntry = {
  id: string;
  action: string;
  severity: string;
  createdAt: string;
  actor: { displayName: string; role: string } | null;
  metadata: Record<string, unknown> | null;
};

export type StudentProfile = {
  id: string;
  studentCode: string;
  massarCode: string | null;
  displayName: string;
  birthDate: string | null;
  schoolYear: string;
  currentClassroom: ClassroomRef | null;
  enrollments: { schoolYear: string; classroom: ClassroomRef }[];
  activationCode: { issuedAt: string | null; expiresAt: string | null; active: boolean } | null;
  guardians: StudentGuardianLink[];
  attendance: AttendanceSummary & {
    schoolYear: string;
    recent: { status: AttendanceStatus; sessionId: string; date: string; slot: AttendanceSlot; classroom: string }[];
  };
  history: StudentHistoryEntry[];
  assessments?: {
    assessmentId: string;
    subject: string;
    title: string;
    date: string;
    maxScore: number;
    score: number | null;
    absent: boolean;
    comment: string | null;
    published: boolean;
  }[];
};

export type GuardianInput = {
  fullName: string;
  email?: string;
  phone?: string;
  phoneSecondary?: string;
  address?: string;
};

export type GuardianView = {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  phoneSecondary: string | null;
  address: string | null;
  hasAccount: boolean;
  pendingInvitation: { id: string; expiresAt: string; createdAt: string } | null;
  students: {
    id: string;
    displayName: string;
    studentCode: string;
    relationship: string | null;
    isPrimary: boolean;
  }[];
};

export type ImportKind = "students" | "guardians";

export type ImportPreview = {
  id: string;
  kind: ImportKind;
  status: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  preview: Record<string, unknown>[];
  errors: { line: number; column?: string; message: string }[];
};

export type ChildSummary = {
  id: string;
  displayName: string;
  studentCode: string;
  classroom: string | null;
  attendance: AttendanceSummary;
};

export type ChildDetail = ChildSummary & {
  schoolYear: string;
  recentUnjustified: number;
  recent: { status: AttendanceStatus; date: string; slot: AttendanceSlot; justified: boolean }[];
};

/* --- Lot 4 : espace parents --------------------------------------------- */

/** t92 M4 : "incomplete" = « à compléter » (complément demandé à la famille). */
export type JustificationStatus = "pending" | "accepted" | "rejected" | "incomplete";

export type Justification = {
  id: string;
  student: { id: string; displayName: string; studentCode: string };
  fromDate: string;
  toDate: string;
  reason: string;
  status: JustificationStatus;
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
  file: { mimeType: string; sizeBytes: number; name: string } | null;
};

export type ParentActionView = {
  id: string;
  student: { id: string; displayName: string; studentCode: string };
  title: string;
  description: string | null;
  dueDate: string | null;
  status: "open" | "done" | "cancelled";
  completedAt: string | null;
  createdAt: string;
  /** t92 M4 : carte liée à un justificatif « à compléter » (fermée à la complétion). */
  justificationId?: string | null;
};

/** t92 M4 : 5 cartes ouvertes au plus ; openTotal / hiddenOpen pour les suivantes. */
export type ParentActionCards = {
  actions: ParentActionView[];
  openTotal: number;
  hiddenOpen: number;
  maxOpen: number;
};

export type NotificationItem = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
};

export type NotificationsResponse = { notifications: NotificationItem[]; unread: number };

/* --- Lot 5 : communication ---------------------------------------------- */

export type MessageKind = "announcement" | "event" | "class_message" | "direct";
/** t92 M5 : "level" (toutes les classes d'un niveau) et "selection" (élèves choisis). */
export type MessageAudience = "school" | "classroom" | "student" | "level" | "selection";

export type ChannelInfo = { channel: "in_app" | "email"; configured: boolean; label: string };
export type DeliveryReport = { channel: ChannelInfo["channel"]; status: "sent" | "not_configured"; label: string; delivered: number };

export type SentMessage = {
  id: string;
  kind: MessageKind;
  audience: MessageAudience;
  title: string;
  important: boolean;
  requiresAck: boolean;
  eventAt: string | null;
  createdAt: string;
  classroom: { id: string; name: string } | null;
  student: { id: string; displayName: string } | null;
  level?: string | null;
  studentIds?: string[];
  recipients: number;
  replies: number;
  readCount: number;
  ackCount: number;
};

export type MessageReplyView = { id: string; body: string; authorRole: string; createdAt: string; mine?: boolean };

export type StaffMessageDetail = Omit<SentMessage, "recipients" | "replies" | "readCount" | "ackCount"> & {
  body: string;
  eventLocation: string | null;
  tracking: { name: string; readAt: string | null; acknowledgedAt: string | null }[];
  replies: MessageReplyView[];
};

export type InboxMessage = {
  id: string;
  kind: MessageKind;
  title: string;
  preview: string;
  important: boolean;
  requiresAck: boolean;
  eventAt: string | null;
  eventLocation: string | null;
  createdAt: string;
  classroom: { name: string } | null;
  student: { displayName: string } | null;
  replies: number;
  readAt: string | null;
  acknowledgedAt: string | null;
};

export type InboxMessageDetail = Omit<InboxMessage, "preview" | "replies"> & { body: string; replies: MessageReplyView[] };

/* --- Lot 6 : agenda et devoirs ------------------------------------------ */

export type AgendaKind = "homework" | "test" | "class_event" | "important_date";

export type AgendaItemView = {
  id: string;
  kind: AgendaKind;
  title: string;
  description: string | null;
  date: string;
  classroom: { id: string; name: string } | null;
  authorRole: string;
  cancelled: boolean;
  createdAt: string;
  updatedAt: string;
  attachments: { id: string; name: string; mimeType: string; sizeBytes: number }[];
};

export type AgendaEvent = {
  id: string;
  title: string;
  at: string;
  location: string | null;
  classroom: { id: string; name: string } | null;
};

export type AgendaRange = { from: string; to: string; items: AgendaItemView[]; events: AgendaEvent[] };

export type AgendaDetail = AgendaItemView & {
  canEdit?: boolean;
  history?: {
    id: string;
    action: string;
    metadata: { changes?: Record<string, { from: string | null; to: string | null }> } | null;
    createdAt: string;
    actor: { displayName: string; role: string } | null;
  }[];
};

// ---- Lot 7 : tableau de bord direction ----
export type DashboardReport = "classes" | "today" | "teachers" | "unjustified" | "activity" | "communications";

export type DashboardDay = {
  date: string;
  sessions: number;
  closed: number;
  present: number;
  absent: number;
  late: number;
  messages: number;
  agenda: number;
  justifications: number;
};

export type DashboardSummary = {
  generatedAt: string;
  range: { from: string; to: string; days: number };
  schoolYear: string;
  students: { total: number; enrolled: number; unassigned: number };
  classes: { id: string; name: string; level: string | null; students: number }[];
  today: {
    date: string;
    sessions: { opened: number; open: number; closed: number };
    classesWithoutSession: number;
    present: number;
    absent: number;
    late: number;
    marked: number;
  };
  unjustified: {
    total: number;
    students: number;
    recent: { studentId: string; student: string; studentCode: string; classroom: string; date: string; slot: "morning" | "afternoon"; status: "absent" | "late" }[];
  };
  teachers: { name: string; sessionsOpened: number; sessionsClosed: number; agendaPublished: number; messagesSent: number }[];
  communications: {
    sent: number;
    byKind: { announcement: number; event: number; class_message: number; direct: number };
    recipients: number;
    read: number;
    readRate: number | null;
    ackExpected: number;
    acknowledged: number;
    ackRate: number | null;
  };
  pending: { justifications: number; oldestJustificationAt: string | null; actionsOpen: number; actionsOverdue: number };
  activity: { hasData: boolean; days: DashboardDay[] };
};

// ---- Lot 8 : préparation Massar ----
export type MassarReport = "students" | "enrollments" | "absences" | "absence-totals" | "anomalies";
export type MassarAnomaly = {
  severity: "error" | "warning";
  code: string;
  studentId: string;
  studentCode: string;
  massarCode: string | null;
  displayName: string;
  detail: string;
};
export type MassarCheck = {
  disclaimer: string;
  schoolYear: string;
  massarPattern: string;
  columnsVersion: string;
  totals: { students: number; withMassar: number; enrolled: number; ready: number; errors: number; warnings: number };
  labels: Record<string, string>;
  byCode: Record<string, number>;
  anomalies: MassarAnomaly[];
};
export type MassarExportRecord = {
  id: string;
  report: MassarReport;
  format: "csv" | "xlsx";
  schoolYear: string;
  from: string | null;
  to: string | null;
  rowCount: number;
  anomalyCount: number;
  sha256: string;
  filename: string;
  columnsVersion: string;
  createdAt: string;
};

// ---- Lot 9 : abonnements et administration SaaS ----
export type SubscriptionStatusValue = "trial" | "active" | "past_due" | "suspended" | "cancelled" | "expired" | "exempt";
export type PlanView = {
  id: string;
  code: string;
  name: string;
  maxStudents: number | null;
  maxStaff: number | null;
  trialDays: number | null;
  priceMinor: number | null;
  currency: string;
  toBeDefined: boolean;
  isActive: boolean;
  notes: string | null;
  subscriptions?: number;
};
export type PlanRef = { id?: string; code: string; name: string; maxStudents: number | null; maxStaff: number | null; toBeDefined?: boolean };
export type SchoolUsage = { students: number; staff: number; parents: number; messages30d: number; sessions30d: number; storageBytes: number; lastActivityAt?: string | null };
export type PlatformSchoolRow = {
  id: string;
  name: string;
  city: string;
  code: string;
  status: string;
  createdAt: string;
  subscription: { status: SubscriptionStatusValue; trialEndsAt: string | null; currentPeriodEnd: string | null; plan: PlanRef | null } | null;
  usage: SchoolUsage;
};
export type PlatformOverview = {
  totals: { schools: number; users: number; students: number; staff: number; parents: number };
  bySchoolStatus: Record<string, number>;
  bySubscription: Record<string, number>;
  trialsEndingSoon: { id: string; name: string; trialEndsAt: string }[];
  schools: PlatformSchoolRow[];
  billingProvider: { name: string; configured: boolean; label: string };
};
export type InvoiceView = { id: string; status: "draft" | "issued" | "void"; periodStart: string; periodEnd: string; amountMinor: number | null; currency: string; planCode: string | null; createdAt: string };
export type SchoolBilling = {
  subscription: { status: SubscriptionStatusValue; trialEndsAt: string | null; currentPeriodEnd: string | null; planRef: PlanRef | null } | null;
  usage: SchoolUsage;
  invoices: InvoiceView[];
  billingProvider: { name: string; configured: boolean; label: string };
};

/* --- Ecran direction « Consentements » (t74u) -------------------------------- */

export type ConsentPurpose = "student_account" | "transport_alerts";
export type ConsentStudentStatus = "accepted" | "withdrawn" | "pending";
export type ConsentChannel = "web" | "mobile" | "paper_school";

export type ConsentTextRow = {
  id: string;
  purpose: ConsentPurpose;
  /** null : brouillon juridique invisible pour la direction (version non communiquee). */
  version: string | null;
  locale: string | null;
  status: "draft" | "validated";
  legalDraft: boolean;
  effectiveAt: string | null;
  retiredAt: string | null;
  accepted: number;
  withdrawn: number;
};

export type ConsentRecordView = {
  id: string;
  purpose: ConsentPurpose;
  channel: ConsentChannel;
  grantedAt: string;
  revokedAt: string | null;
  guardian: string | null;
  paperDate: string | null;
  paperFileReference: string | null;
  hasScan: boolean;
  textId: string;
};

export type ConsentStudentRow = {
  id: string;
  displayName: string;
  studentCode: string;
  accountStatus: "none" | "active" | "suspended_no_consent";
  classroom: { id: string; name: string } | null;
  purposes: Record<ConsentPurpose, { status: ConsentStudentStatus; latestId: string | null }>;
  records: ConsentRecordView[];
};

export type ConsentOverview = {
  schoolYear: string;
  truncated: boolean;
  classrooms: { id: string; name: string }[];
  texts: ConsentTextRow[];
  current: { purpose: ConsentPurpose; locale: "fr" | "ar"; textId: string | null; version: string | null; legalDraft: boolean }[];
  purposes: { purpose: ConsentPurpose; accepted: number; withdrawn: number; pending: number; refused: null }[];
  students: ConsentStudentRow[];
};

/* --- t92 (CDC M2) : calendrier de l'établissement ------------------------ */

export type SchoolHolidayView = { id: string; label: string; startDate: string; endDate: string };

export type SchoolCalendarView = {
  timezone: string;
  schoolYear: string;
  configured: boolean;
  /** Jours ISO : 1 = lundi … 7 = dimanche. */
  workingDays: number[];
  updatedAt: string | null;
  holidays: SchoolHolidayView[];
};

/* --- t92 (CDC M7) : résultats ------------------------------------------- */

export type AssessmentView = {
  id: string;
  classroomId: string;
  classroom: string;
  schoolYear: string;
  subject: string;
  title: string;
  date: string;
  maxScore: number;
  publishedAt: string | null;
  resultCount: number;
};

export type AssessmentDetail = AssessmentView & {
  students: { studentId: string; displayName: string; studentCode: string; score: number | null; absent: boolean; comment: string | null }[];
};

export type PublishedResult = {
  assessmentId: string;
  subject: string;
  title: string;
  date: string;
  maxScore: number;
  score: number | null;
  absent: boolean;
  comment: string | null;
};

/* --- t92 (CDC 3.2 / 3.5 / 5) : circuits de transport --------------------- */

export type BusCircuitView = {
  id: string;
  name: string;
  active: boolean;
  attendantProfileId: string | null;
  attendant: string | null;
  stops: { id: string; name: string; position: number }[];
  studentCount: number;
};

export type RoadmapStudent = {
  id: string;
  displayName: string;
  bus: { date: string; status: string; label: string; updatedAt: string } | null;
};

export type CircuitRoadmap = {
  circuit: BusCircuitView;
  date: string;
  stops: { id: string; name: string; position: number; students: RoadmapStudent[] }[];
  withoutStop: RoadmapStudent[];
};
