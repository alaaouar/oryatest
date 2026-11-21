import type {
  SchoolCalendarView,
  BusCircuitView,
  CircuitRoadmap,
  AssessmentDetail,
  AssessmentView,
  PublishedResult,
  SchoolHolidayView,
  AssignmentRow,
  AttendanceSlot,
  AttendanceStatus,
  AuditRow,
  ClassroomsResponse,
  HistoryEntry,
  MarkResult,
  RosterResponse,
  SessionDetail,
  SessionSummary,
  TeacherRow,
  LoginResponse,
  MfaEnrollment,
  MeResponse,
  SchoolRow,
  StudentListRow,
  StudentProfile,
  GuardianView,
  GuardianInput,
  ImportKind,
  ImportPreview,
  ChildSummary,
  ChildDetail,
  Justification,
  JustificationStatus,
  ParentActionCards,
  ParentActionView,
  NotificationsResponse,
  ChannelInfo,
  DeliveryReport,
  MessageKind,
  MessageAudience,
  SentMessage,
  StaffMessageDetail,
  InboxMessage,
  InboxMessageDetail,
  MessageReplyView,
  AgendaKind,
  AgendaItemView,
  AgendaRange,
  AgendaDetail,
  DashboardReport,
  DashboardSummary,
  MassarCheck,
  MassarExportRecord,
  MassarReport,
  PlanView,
  PlatformOverview,
  SchoolBilling,
  SubscriptionStatusValue,
  ConsentOverview,
  ConsentPurpose,
} from "./types";

/**
 * Résolution dynamique de l'URL de base de l'API :
 * 1. Côté serveur (fonctions runtime Vercel, Server Actions, SSR) : lit la liaison interne injectée `API_URL`.
 * 2. Côté client / build : variable d'environnement publique explicite `NEXT_PUBLIC_API_BASE`.
 * 3. En production navigateur (même domaine avec réécriture Vercel Services `/api/(.*)` -> service api) : chemin relatif `/api/v1`.
 * 4. Repli de développement local : http://localhost:3200/api/v1.
 */
export function getApiBase(): string {
  if (typeof window === "undefined" && process.env.API_URL) {
    return new URL("/api/v1", process.env.API_URL).toString().replace(/\/$/, "");
  }
  if (process.env.NEXT_PUBLIC_API_BASE) {
    return process.env.NEXT_PUBLIC_API_BASE.replace(/\/$/, "");
  }
  if (typeof window !== "undefined" && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") {
    return "/api/v1";
  }
  return "http://localhost:3200/api/v1";
}
const STORAGE_KEY = "orya.session";

/**
 * Lot 10 : session en cookies httpOnly posés par l'API (jamais lisibles par le
 * JavaScript). Seul le jeton CSRF (non secret vis-à-vis d'un tiers, inutile sans
 * le cookie) est gardé en sessionStorage pour l'en-tête X-CSRF-Token.
 */
export type WebSession = { csrfToken: string };

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function readCsrf(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window.sessionStorage.getItem(STORAGE_KEY);
}

export function saveSession(session: { csrfToken?: string }): void {
  if (session.csrfToken) {
    window.sessionStorage.setItem(STORAGE_KEY, session.csrfToken);
  }
}

export function clearTokens(): void {
  if (typeof window !== "undefined") {
    window.sessionStorage.removeItem(STORAGE_KEY);
    // ADR-003 : copie du profil pour l'appel hors ligne (voir lib/session.tsx).
    window.sessionStorage.removeItem("orya.me.offline");
  }
}

export function hasSession(): boolean {
  return readCsrf() !== null;
}

/**
 * B07 : le jeton CSRF vit en sessionStorage (par onglet). Il manque dans un nouvel onglet,
 * ou si l'on navigue avant que la reponse de mfa/verify soit traitee, alors que les cookies
 * httpOnly de session sont valides. On le recupere par GET /auth/csrf (session cookie active
 * exigee cote API, aucun jeton de session emis) au lieu de renvoyer vers /login.
 */
export async function ensureCsrf(force = false): Promise<boolean> {
  if (typeof window === "undefined") {
    return false;
  }
  if (!force && readCsrf()) {
    return true;
  }
  try {
    const response = await fetch(`${getApiBase()}/auth/csrf`, {
      method: "GET",
      headers: new Headers({ "X-Orya-Client": "web" }),
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok) {
      return false;
    }
    const payload = (await response.json()) as { csrfToken?: string };
    if (!payload.csrfToken) {
      return false;
    }
    saveSession(payload);
    return true;
  } catch {
    return false;
  }
}

function webHeaders(headers: Headers = new Headers()): Headers {
  headers.set("X-Orya-Client", "web");
  const csrf = readCsrf();
  if (csrf) {
    headers.set("X-CSRF-Token", csrf);
  }
  return headers;
}

function messageFrom(payload: unknown): string {
  if (payload && typeof payload === "object" && "message" in payload) {
    const value = (payload as { message: unknown }).message;
    if (Array.isArray(value)) {
      return value.join(" ");
    }
    if (typeof value === "string") {
      return value;
    }
  }
  return "Une erreur est survenue. Réessayez.";
}

async function refreshTokens(): Promise<boolean> {
  if (!readCsrf()) {
    return false;
  }

  const response = await fetch(`${getApiBase()}/auth/refresh`, {
    method: "POST",
    headers: webHeaders(new Headers({ "Content-Type": "application/json" })),
    body: "{}",
    credentials: "include",
    cache: "no-store",
  });

  if (!response.ok) {
    clearTokens();
    return false;
  }

  saveSession((await response.json()) as { csrfToken?: string });
  return true;
}

async function call<T>(path: string, init: RequestInit, retry: boolean): Promise<T> {
  const headers = webHeaders(new Headers(init.headers));

  // Bloc 3b : un FormData (multipart) garde son Content-Type avec boundary, pose par le navigateur.
  if (init.body !== undefined && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${getApiBase()}${path}`, { ...init, headers, credentials: "include", cache: "no-store" });

  if (response.status === 401 && retry) {
    if (await refreshTokens()) {
      return call<T>(path, init, false);
    }
  }

  // B07 : jeton CSRF de l'onglet absent ou perime (cookie remplace par une connexion dans un
  // autre onglet) : une seule reprise via GET /auth/csrf, puis nouvel essai. Le controle CSRF
  // cote API reste entier : sans session cookie valide, la reprise echoue (401).
  if (response.status === 403 && retry && init.method && init.method !== "GET") {
    const payload = (await response.clone().json().catch(() => null)) as { message?: unknown } | null;
    if (typeof payload?.message === "string" && /CSRF/i.test(payload.message) && (await ensureCsrf(true))) {
      return call<T>(path, init, false);
    }
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new ApiError(response.status, messageFrom(payload));
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export function get<T>(path: string): Promise<T> {
  return call<T>(path, { method: "GET" }, true);
}

export function post<T>(path: string, body?: unknown): Promise<T> {
  return call<T>(
    path,
    { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) },
    true,
  );
}

/** Envoi multipart (fichiers) : meme session, CSRF et rafraichissement que post(). */
export function postForm<T>(path: string, form: FormData): Promise<T> {
  return call<T>(path, { method: "POST", body: form }, true);
}

export function patch<T>(path: string, body: unknown): Promise<T> {
  return call<T>(path, { method: "PATCH", body: JSON.stringify(body) }, true);
}

export function del<T>(path: string): Promise<T> {
  return call<T>(path, { method: "DELETE" }, true);
}

/* --- Authentification ---------------------------------------------------- */

export function login(email: string, password: string): Promise<LoginResponse> {
  return post<LoginResponse>("/auth/login", { email, password, platform: "web" });
}

export function enrollMfa(challengeToken: string): Promise<MfaEnrollment> {
  return post<MfaEnrollment>("/auth/mfa/enroll", { challengeToken });
}

export function verifyMfa(challengeToken: string, code: string) {
  return post<{ csrfToken: string; profile: unknown }>(
    "/auth/mfa/verify",
    { challengeToken, code },
  );
}

export async function logout(): Promise<void> {
  try {
    await post<{ ok: boolean }>("/auth/logout");
  } finally {
    clearTokens();
  }
}

/* --- Session ------------------------------------------------------------- */

export function me(): Promise<MeResponse> {
  return get<MeResponse>("/me");
}

export function selectProfile(profileId: string) {
  return post<{ csrfToken: string; profile: unknown }>("/me/profiles/select", { profileId }).then((result) => {
    saveSession(result);
    return result;
  });
}

/* --- Administration ------------------------------------------------------ */

export async function listSchools(): Promise<SchoolRow[]> {
  const data = await get<{ schools: SchoolRow[] }>("/schools");
  return data.schools;
}

export function createSchool(input: {
  name: string;
  city: string;
  ice?: string;
  status?: "pending" | "active";
  adminEmail?: string;
  adminName?: string;
  adminPassword?: string;
}) {
  return post<
    SchoolRow & {
      admin?: {
        profileId: string;
        userId: string;
        email: string;
        displayName: string;
        initialPassword?: string;
      } | null;
    }
  >("/schools", input);
}

export function createSchoolAdmin(
  schoolId: string,
  input: {
    email: string;
    displayName: string;
    password?: string;
  },
) {
  return post<{
    profileId: string;
    userId: string;
    email: string;
    displayName: string;
    schoolId: string;
    initialPassword?: string;
  }>(`/schools/${encodeURIComponent(schoolId)}/admins`, input);
}

export function validateSchool(schoolId: string) {
  return post<SchoolRow>(`/schools/${schoolId}/validate`);
}

export function createInvitation(input: {
  role: "teacher" | "bus_attendant";
  email: string;
}) {
  return post<{ invitationId: string; token: string; expiresAt: string }>("/invitations", input);
}

/* --- Journal d'audit ----------------------------------------------------- */

export async function listAudit(limit = 100): Promise<AuditRow[]> {
  const data = await get<{ entries: AuditRow[] }>(`/audit?limit=${limit}`);
  return data.entries;
}

/* --- Présences (Lot 2.2 / 2.3) ------------------------------------------- */

export function listClassrooms(schoolYear?: string): Promise<ClassroomsResponse> {
  const query = schoolYear ? `?schoolYear=${encodeURIComponent(schoolYear)}` : "";
  return get<ClassroomsResponse>(`/classrooms${query}`);
}

export async function listTeachers(): Promise<TeacherRow[]> {
  const data = await get<{ teachers: TeacherRow[] }>("/teachers");
  return data.teachers;
}

export async function listAssignments(): Promise<AssignmentRow[]> {
  const data = await get<{ assignments: AssignmentRow[] }>("/assignments");
  return data.assignments;
}

export function createAssignment(input: {
  teacherProfileId: string;
  classroomId: string;
  schoolYear: string;
}) {
  return post<{ id: string }>("/assignments", input);
}

export function deleteAssignment(assignmentId: string) {
  return del<{ ok: boolean }>(`/assignments/${encodeURIComponent(assignmentId)}`);
}

export async function findSessions(
  classroomId: string,
  date: string,
  slot?: AttendanceSlot,
): Promise<SessionSummary[]> {
  const params = new URLSearchParams({ classroomId, date });
  if (slot) {
    params.set("slot", slot);
  }
  const data = await get<{ sessions: SessionSummary[] }>(`/attendance/sessions?${params.toString()}`);
  return data.sessions;
}

export function openSession(input: { classroomId: string; date: string; slot: AttendanceSlot }) {
  return post<{ id: string }>("/attendance/sessions", input);
}

export function getSession(sessionId: string): Promise<SessionDetail> {
  return get<SessionDetail>(`/attendance/sessions/${encodeURIComponent(sessionId)}`);
}

export function getRoster(classroomId: string, date: string): Promise<RosterResponse> {
  return get<RosterResponse>(
    `/attendance/classrooms/${encodeURIComponent(classroomId)}/roster?date=${encodeURIComponent(date)}`,
  );
}

/** Le backend accepte 200 lignes par appel : on découpe au-delà. */
export async function markRows(
  sessionId: string,
  rows: { studentId: string; status: AttendanceStatus }[],
): Promise<MarkResult> {
  const total: MarkResult = { accepted: 0, rejected: [], changed: 0 };
  for (let index = 0; index < rows.length; index += 200) {
    const chunk = rows.slice(index, index + 200);
    const result = await post<MarkResult>(
      `/attendance/sessions/${encodeURIComponent(sessionId)}/rows/bulk`,
      { rows: chunk },
    );
    total.accepted += result.accepted;
    total.changed += result.changed ?? 0;
    total.rejected.push(...result.rejected);
  }
  return total;
}

export function closeSession(sessionId: string) {
  return post<{ ok: boolean; status: string }>(`/attendance/sessions/${encodeURIComponent(sessionId)}/close`);
}

export function reopenSession(sessionId: string, reason: string) {
  return post<{ ok: boolean; status: string }>(
    `/attendance/sessions/${encodeURIComponent(sessionId)}/reopen`,
    { reason },
  );
}

export async function sessionHistory(sessionId: string): Promise<HistoryEntry[]> {
  const data = await get<{ entries: HistoryEntry[] }>(
    `/attendance/sessions/${encodeURIComponent(sessionId)}/history`,
  );
  return data.entries;
}

/* --- Lot 3 : élèves, familles, imports, activation --------------------- */

const enc = encodeURIComponent;

export async function listStudents(filters: {
  search?: string;
  classroomId?: string;
  unassigned?: boolean;
} = {}): Promise<StudentListRow[]> {
  const params = new URLSearchParams();
  if (filters.search) params.set("search", filters.search);
  if (filters.classroomId) params.set("classroomId", filters.classroomId);
  if (filters.unassigned) params.set("unassigned", "true");
  const query = params.toString();
  const data = await get<{ students: StudentListRow[] }>(`/students${query ? `?${query}` : ""}`);
  return data.students;
}

export function getStudentProfile(studentId: string): Promise<StudentProfile> {
  return get<StudentProfile>(`/students/${enc(studentId)}/profile`);
}

export function updateStudent(
  studentId: string,
  input: { displayName?: string; birthDate?: string | null; massarCode?: string | null },
) {
  return patch<unknown>(`/students/${enc(studentId)}`, input);
}

export function changeStudentClass(studentId: string, classroomId: string, schoolYear: string) {
  return post<{ from: string | null; to: string }>(`/students/${enc(studentId)}/enrollment`, {
    classroomId,
    schoolYear,
  });
}

export function issueActivationCode(studentId: string) {
  return post<{ code: string; expiresAt: string; instruction: string }>(
    `/students/${enc(studentId)}/activation-code`,
  );
}

export async function listGuardians(search?: string): Promise<GuardianView[]> {
  const data = await get<{ guardians: GuardianView[] }>(`/guardians${search ? `?search=${enc(search)}` : ""}`);
  return data.guardians;
}

export function getGuardian(guardianId: string): Promise<GuardianView> {
  return get<GuardianView>(`/guardians/${enc(guardianId)}`);
}

export function createGuardian(input: GuardianInput): Promise<GuardianView> {
  return post<GuardianView>("/guardians", input);
}

export function updateGuardian(guardianId: string, input: Partial<GuardianInput>): Promise<GuardianView> {
  return patch<GuardianView>(`/guardians/${enc(guardianId)}`, input);
}

export function linkGuardian(
  guardianId: string,
  input: { studentId: string; relationship?: string; isPrimary?: boolean },
): Promise<GuardianView> {
  return post<GuardianView>(`/guardians/${enc(guardianId)}/students`, input);
}

export function unlinkGuardian(guardianId: string, studentId: string): Promise<GuardianView> {
  return del<GuardianView>(`/guardians/${enc(guardianId)}/students/${enc(studentId)}`);
}

export function inviteGuardian(guardianId: string) {
  return post<{ invitationId: string; token: string; expiresAt: string }>(
    `/guardians/${enc(guardianId)}/invitation`,
  );
}

export function startImport(input: {
  filename: string;
  contentBase64: string;
  schoolYear: string;
  kind: ImportKind;
}): Promise<ImportPreview> {
  return post<ImportPreview>("/imports", input);
}

export function commitImport(jobId: string): Promise<Record<string, unknown>> {
  return post<Record<string, unknown>>(`/imports/${enc(jobId)}/commit`);
}

export function cancelImport(jobId: string) {
  return post<unknown>(`/imports/${enc(jobId)}/cancel`);
}

export async function listMyChildren(): Promise<ChildSummary[]> {
  const data = await get<{ children: ChildSummary[] }>("/family/children");
  return data.children;
}

export function getMyChild(studentId: string): Promise<ChildDetail> {
  return get<ChildDetail>(`/family/children/${enc(studentId)}`);
}

type ActivationSession = { csrfToken: string };

/** Routes publiques : aucun jeton n'est envoyé. */
async function publicPost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${getApiBase()}${path}`, {
    method: "POST",
    headers: webHeaders(new Headers({ "Content-Type": "application/json" })),
    body: JSON.stringify(body),
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new ApiError(response.status, messageFrom(payload));
  }
  return (await response.json()) as T;
}

/** F01 (t87u) : mot de passe oublie (reponse identique que le compte existe ou non). */
export function requestPasswordReset(email: string) {
  return publicPost<{ ok: boolean; message: string }>("/auth/password/forgot", { email });
}

/** F01 (t87u) : nouveau mot de passe a partir du lien recu par e-mail ; toutes les sessions sont revoquees. */
export function confirmPasswordReset(token: string, newPassword: string) {
  return publicPost<{ ok: boolean; revokedSessions: number }>("/auth/password/reset", { token, newPassword });
}

export function acceptInvitation(input: { token: string; password: string; fullName?: string }) {
  return publicPost<ActivationSession>("/activation/invitation", input);
}

export function activateParent(input: {
  schoolCode: string;
  activationCode: string;
  email: string;
  password: string;
  fullName: string;
  relationship?: string;
}) {
  return publicPost<ActivationSession>("/activation/parent", input);
}

/* --- Lot 4 : espace parents ------------------------------------------- */

export async function listMyJustifications(): Promise<Justification[]> {
  return (await get<{ justifications: Justification[] }>("/family/justifications")).justifications;
}

export function submitJustification(input: {
  studentId: string;
  fromDate: string;
  toDate: string;
  reason: string;
  file?: File;
}): Promise<Justification> {
  const form = new FormData();
  form.append("studentId", input.studentId);
  form.append("fromDate", input.fromDate);
  form.append("toDate", input.toDate);
  form.append("reason", input.reason);
  if (input.file) form.append("file", input.file, input.file.name);
  return postForm<Justification>("/family/justifications", form);
}

export async function listSchoolJustifications(status?: JustificationStatus): Promise<Justification[]> {
  return (await get<{ justifications: Justification[] }>(`/justifications${status ? `?status=${status}` : ""}`))
    .justifications;
}

export function reviewJustification(id: string, decision: "accepted" | "rejected" | "incomplete", note?: string) {
  return post<Justification>(`/justifications/${enc(id)}/review`, { decision, note });
}

export async function listMyActions(): Promise<ParentActionView[]> {
  return (await listMyActionCards()).actions;
}

/** t92 M4 : cartes « À faire » (5 ouvertes au plus) avec le nombre de demandes masquées. */
export function listMyActionCards(): Promise<ParentActionCards> {
  return get<ParentActionCards>("/family/actions");
}

/** t92 M4 : complément d'un justificatif « à compléter » (précision et/ou nouvelle pièce). */
export function completeJustification(id: string, input: { reason?: string; file?: File }): Promise<Justification> {
  const form = new FormData();
  if (input.reason) form.append("reason", input.reason);
  if (input.file) form.append("file", input.file, input.file.name);
  return postForm<Justification>(`/family/justifications/${enc(id)}/complete`, form);
}

export function completeAction(id: string): Promise<ParentActionView> {
  return post<ParentActionView>(`/family/actions/${enc(id)}/done`);
}

export async function listSchoolActions(studentId?: string): Promise<ParentActionView[]> {
  return (await get<{ actions: ParentActionView[] }>(`/parent-actions${studentId ? `?studentId=${enc(studentId)}` : ""}`))
    .actions;
}

export function createParentAction(input: { studentId: string; title: string; description?: string; dueDate?: string }) {
  return post<ParentActionView & { notified: number }>("/parent-actions", input);
}

export function cancelParentAction(id: string) {
  return post<ParentActionView>(`/parent-actions/${enc(id)}/cancel`);
}

export function listNotifications(): Promise<NotificationsResponse> {
  return get<NotificationsResponse>("/notifications");
}

export function markNotificationRead(id: string) {
  return post<unknown>(`/notifications/${enc(id)}/read`);
}

export function markAllNotificationsRead() {
  return post<unknown>("/notifications/read-all");
}

/**
 * Téléchargement d'un fichier privé : le jeton part dans l'en-tête, jamais
 * dans l'URL ; le fichier est remis au navigateur via un lien temporaire local.
 */
export async function downloadPrivateFile(path: string, filename: string): Promise<void> {
  const attempt = async () => {
    return fetch(`${getApiBase()}${path}`, {
      headers: webHeaders(),
      credentials: "include",
      cache: "no-store",
    });
  };
  let response = await attempt();
  if (response.status === 401 && (await refreshTokens())) {
    response = await attempt();
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new ApiError(response.status, messageFrom(payload));
  }
  // Bloc 3 (stockage S3) : l'API renvoie une URL pre-signee courte, jamais le contenu.
  if ((response.headers.get("content-type") ?? "").includes("application/json")) {
    const payload = (await response.json().catch(() => null)) as { url?: string } | null;
    if (!payload?.url) throw new ApiError(502, "Lien de telechargement indisponible.");
    const direct = document.createElement("a");
    direct.href = payload.url;
    direct.rel = "noopener noreferrer";
    direct.click();
    return;
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/* --- Lot 5 : communication ------------------------------------------- */

export async function listChannels(): Promise<ChannelInfo[]> {
  return (await get<{ channels: ChannelInfo[] }>("/messages/channels")).channels;
}

export function sendMessage(input: {
  kind: MessageKind;
  audience: MessageAudience;
  classroomId?: string;
  studentId?: string;
  level?: string;
  studentIds?: string[];
  title: string;
  body: string;
  important?: boolean;
  requiresAck?: boolean;
  eventAt?: string;
  eventLocation?: string;
  channels?: "email"[];
}) {
  return post<{ id: string; recipients: number; delivery: DeliveryReport[] }>("/messages", input);
}

export async function listSentMessages(): Promise<SentMessage[]> {
  return (await get<{ messages: SentMessage[] }>("/messages")).messages;
}

export function getStaffMessage(id: string): Promise<StaffMessageDetail> {
  return get<StaffMessageDetail>(`/messages/${enc(id)}`);
}

export function replyAsStaff(id: string, body: string) {
  return post<MessageReplyView>(`/messages/${enc(id)}/replies`, { body });
}

export async function listInbox(kind?: MessageKind): Promise<InboxMessage[]> {
  return (await get<{ messages: InboxMessage[] }>(`/family/messages${kind ? `?kind=${kind}` : ""}`)).messages;
}

export function openInboxMessage(id: string): Promise<InboxMessageDetail> {
  return get<InboxMessageDetail>(`/family/messages/${enc(id)}`);
}

export function acknowledgeMessage(id: string) {
  return post<{ acknowledgedAt: string }>(`/family/messages/${enc(id)}/ack`);
}

export function replyAsParent(id: string, body: string) {
  return post<MessageReplyView>(`/family/messages/${enc(id)}/replies`, { body });
}

/* --- Lot 6 : agenda et devoirs --------------------------------------- */

function rangeQuery(input: { from?: string; to?: string; classroomId?: string }) {
  const params = new URLSearchParams();
  if (input.from) params.set("from", input.from);
  if (input.to) params.set("to", input.to);
  if (input.classroomId) params.set("classroomId", input.classroomId);
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function listAgenda(input: { from?: string; to?: string; classroomId?: string } = {}): Promise<AgendaRange> {
  return get<AgendaRange>(`/agenda${rangeQuery(input)}`);
}

export function listFamilyAgenda(input: { from?: string; to?: string } = {}): Promise<AgendaRange> {
  return get<AgendaRange>(`/family/agenda${rangeQuery(input)}`);
}

export function getAgendaItem(id: string, asParent = false): Promise<AgendaDetail> {
  return get<AgendaDetail>(`${asParent ? "/family/agenda" : "/agenda"}/${enc(id)}`);
}

export function createAgendaItem(input: {
  kind: AgendaKind;
  classroomId?: string;
  title: string;
  description?: string;
  date: string;
  attachments?: File[];
}) {
  const form = new FormData();
  form.append("kind", input.kind);
  if (input.classroomId) form.append("classroomId", input.classroomId);
  form.append("title", input.title);
  if (input.description) form.append("description", input.description);
  form.append("date", input.date);
  for (const file of input.attachments ?? []) form.append("attachments", file, file.name);
  return postForm<AgendaItemView & { notified: number }>("/agenda", form);
}

export function updateAgendaItem(id: string, input: { title?: string; description?: string; date?: string }) {
  return patch<AgendaItemView>(`/agenda/${enc(id)}`, input);
}

export function cancelAgendaItem(id: string) {
  return post<AgendaItemView>(`/agenda/${enc(id)}/cancel`);
}

export function addAgendaAttachment(id: string, file: File) {
  const form = new FormData();
  form.append("file", file, file.name);
  return postForm<AgendaItemView>(`/agenda/${enc(id)}/attachments`, form);
}

export function downloadAgendaAttachment(itemId: string, attachmentId: string, name: string, asParent = false) {
  return downloadPrivateFile(
    `${asParent ? "/family/agenda" : "/agenda"}/${enc(itemId)}/attachments/${enc(attachmentId)}/file`,
    name,
  );
}

/** Message utilisateur pour une erreur d'API (codes 400 à 429 + réseau). */
export function describeError(cause: unknown): string {
  if (cause instanceof ApiError) {
    switch (cause.status) {
      case 400:
        return cause.message || "Données invalides.";
      case 401:
        return "Votre session a expiré. Reconnectez-vous.";
      case 403:
        return cause.message || "Accès refusé pour votre profil.";
      case 404:
        return cause.message || "Élément introuvable ou inaccessible.";
      case 409:
        return cause.message || "Conflit : l'élément a été modifié entre-temps.";
      case 413:
        return "Requête trop volumineuse. Réessayez avec moins d'éléments.";
      case 429:
        return "Trop de requêtes. Patientez une minute avant de réessayer.";
      default:
        return cause.status >= 500
          ? "Le serveur a rencontré une erreur. Réessayez dans un instant."
          : cause.message;
    }
  }
  if (cause instanceof TypeError) {
    return "Serveur injoignable. Vérifiez votre connexion.";
  }
  return "Une erreur inattendue est survenue.";
}
// ---- Lot 7 : tableau de bord direction ----
export function getDashboard(from?: string, to?: string): Promise<DashboardSummary> {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const query = params.toString();
  return get<DashboardSummary>(`/dashboard/summary${query ? `?${query}` : ""}`);
}

export function exportDashboard(report: DashboardReport, format: "csv" | "xlsx", from: string, to: string): Promise<void> {
  const params = new URLSearchParams({ report, format, from, to });
  return downloadPrivateFile(`/dashboard/export?${params.toString()}`, `orya-${report}-${from}-${to}.${format}`);
}

// ---- Lot 8 : préparation Massar (format ORYA compatible, sans connexion officielle) ----
export function getMassarCheck(schoolYear?: string): Promise<MassarCheck> {
  return get<MassarCheck>(`/massar/check${schoolYear ? `?schoolYear=${encodeURIComponent(schoolYear)}` : ""}`);
}

export async function listMassarExports(): Promise<MassarExportRecord[]> {
  const result = await get<{ exports: MassarExportRecord[] }>("/massar/exports");
  return result.exports;
}

export function exportMassar(report: MassarReport, format: "csv" | "xlsx", schoolYear: string, from?: string, to?: string): Promise<void> {
  const params = new URLSearchParams({ report, format, schoolYear });
  const period = report === "absences" || report === "absence-totals";
  if (period && from && to) {
    params.set("from", from);
    params.set("to", to);
  }
  const suffix = period && from && to ? `-${from}-${to}` : "";
  return downloadPrivateFile(`/massar/export?${params.toString()}`, `orya-compatible-massar-${report}-${schoolYear}${suffix}.${format}`);
}

// ---- Lot 9 : administration SaaS (super-admin) et abonnement (direction) ----
export function getPlatformOverview(): Promise<PlatformOverview> {
  return get<PlatformOverview>("/admin/overview");
}

export async function listPlans(): Promise<PlanView[]> {
  return (await get<{ plans: PlanView[] }>("/admin/plans")).plans;
}

export function createPlan(input: { code: string; name: string; maxStudents?: number | null; maxStaff?: number | null; trialDays?: number | null; priceMinor?: number | null; notes?: string }): Promise<PlanView> {
  return post<PlanView>("/admin/plans", input);
}

export function updatePlan(id: string, input: Partial<Omit<PlanView, "id" | "code" | "currency" | "subscriptions">>): Promise<PlanView> {
  return patch<PlanView>(`/admin/plans/${id}`, input);
}

export function updateSubscription(schoolId: string, input: { planId?: string; status?: SubscriptionStatusValue; trialEndsAt?: string; currentPeriodEnd?: string; reason?: string }): Promise<unknown> {
  return patch<unknown>(`/admin/schools/${schoolId}/subscription`, input);
}

export function draftInvoice(schoolId: string, periodStart: string, periodEnd: string): Promise<unknown> {
  return post<unknown>(`/admin/schools/${schoolId}/invoices`, { periodStart, periodEnd });
}

export function takeUsageSnapshot(schoolId: string): Promise<unknown> {
  return post<unknown>(`/admin/schools/${schoolId}/usage-snapshots`);
}

export function getSchoolBilling(): Promise<SchoolBilling> {
  return get<SchoolBilling>("/billing");
}

// --- Bloc 4 : bus (statut seulement), espace eleve, export et droits ---
export type BusView = { date: string; status: "not_planned" | "waiting" | "on_board" | "dropped_off" | "absent"; label: string; updatedAt: string };
export type BusHistory = { today: BusView | null; history: BusView[] };
export function getChildBus(studentId: string): Promise<BusHistory> {
  return get<BusHistory>(`/family/children/${encodeURIComponent(studentId)}/bus`);
}
export type StudentMe = { displayName: string; classroom: { id: string; name: string } | null; schoolYear: string; readOnly: true };
export const studentApi = {
  me: () => get<StudentMe>("/student/me"),
  agenda: () => get<{ items: { id: string; kind: string; title: string; description: string | null; date: string; classroom: string | null }[] }>("/student/agenda"),
  attendance: () => get<{ items: { date: string; slot: string; status: "present" | "absent" | "late" }[] }>("/student/attendance"),
  justifications: () => get<{ items: { id: string; fromDate: string; toDate: string; status: "pending" | "accepted" | "rejected" }[] }>("/student/justifications"),
  bus: () => get<BusHistory>("/student/bus"),
  /** t92 (CDC M3) : informations de l'ecole (absence / retard enregistres). */
  notifications: () => get<{ items: { id: string; kind: string; title: string; body: string | null; createdAt: string }[] }>("/student/notifications"),
  /** t92 (CDC M7) : résultats publiés. */
  results: () => get<{ items: PublishedResult[] }>("/student/results"),
};
export type DataExportView = { id: string; status: string; requestedAt: string; readyAt: string | null; expiresAt: string | null };
/** t50u : suppression de compte depuis "Mes donnees" (POST me/deletion {password, mfaCode?}). */
export type MyDeletionRequest = { id: string; status: string; kind: string; requestedAt: string; effectiveAt: string | null; completedAt: string | null; cancelledAt: string | null };
export function getMyDeletion(): Promise<{ request: MyDeletionRequest | null }> {
  return get<{ request: MyDeletionRequest | null }>("/me/deletion");
}
export function requestMyDeletion(password: string, mfaCode?: string): Promise<{ status: string }> {
  return post<{ status: string }>("/me/deletion", mfaCode ? { password, mfaCode } : { password });
}
/** t62u A1 : changement de mot de passe ; les autres sessions sont revoquees par l'API. */
export function changeMyPassword(currentPassword: string, newPassword: string): Promise<{ ok: boolean; revokedSessions: number }> {
  return post<{ ok: boolean; revokedSessions: number }>("/me/password", { currentPassword, newPassword });
}
export function cancelMyDeletion(): Promise<{ ok: boolean }> {
  return del<{ ok: boolean }>("/me/deletion");
}

export function requestDataExport(): Promise<DataExportView> {
  return post<DataExportView>("/me/data-export");
}
export function listDataExports(): Promise<{ items: DataExportView[] }> {
  return get<{ items: DataExportView[] }>("/me/data-export");
}
export function dataExportLink(id: string, format: "json" | "pdf"): Promise<{ url?: string; expiresInSeconds?: number }> {
  return get(`/me/data-export/${encodeURIComponent(id)}/${format}`);
}
export type DataRightsView = { id: string; kind: "rectification" | "opposition"; subject: string; message: string; status: "open" | "closed"; createdAt: string; handledAt: string | null; response: string | null };
export function createDataRights(body: { kind: "rectification" | "opposition"; subject: string; message: string }): Promise<DataRightsView> {
  return post<DataRightsView>("/me/data-rights", body);
}
export function listMyDataRights(): Promise<{ items: DataRightsView[] }> {
  return get<{ items: DataRightsView[] }>("/me/data-rights");
}

/* --- Consentements (direction, t74u) ---------------------------------------- */

/** Apercu en lecture seule des consentements parentaux de l'ecole (direction uniquement). */
export function getConsentOverview(): Promise<ConsentOverview> {
  return get<ConsentOverview>("/consents/overview");
}

/** Consentement papier recueilli par l'ecole (route existante, direction, texte VALIDE requis). */
export function recordPaperConsent(
  studentId: string,
  input: { textId: string; purpose: ConsentPurpose; guardianName: string; paperDate: string; paperFileReference: string },
) {
  return post<{ id: string; grantedAt: string }>(`/students/${enc(studentId)}/consents/paper`, input);
}

/* --- t92 (CDC M2) : calendrier de l'établissement ------------------------ */

export function getSchoolCalendar(): Promise<SchoolCalendarView> {
  return get<SchoolCalendarView>("/calendar");
}

export function setWorkingDays(workingDays: number[]): Promise<SchoolCalendarView> {
  return call<SchoolCalendarView>("/calendar/working-days", { method: "PUT", body: JSON.stringify({ workingDays }) }, true);
}

export function addHoliday(input: { label: string; startDate: string; endDate: string }): Promise<SchoolHolidayView> {
  return post<SchoolHolidayView>("/calendar/holidays", input);
}

export function deleteHoliday(id: string): Promise<{ ok: boolean }> {
  return del<{ ok: boolean }>(`/calendar/holidays/${enc(id)}`);
}

/* --- t92 (CDC M7) : résultats ------------------------------------------- */

export function listAssessments(classroomId?: string): Promise<{ schoolYear: string; assessments: AssessmentView[] }> {
  const query = classroomId ? `?classroomId=${enc(classroomId)}` : "";
  return get<{ schoolYear: string; assessments: AssessmentView[] }>(`/results/assessments${query}`);
}

export function createAssessment(input: { classroomId: string; subject: string; title: string; date: string; maxScore?: number }): Promise<AssessmentView> {
  return post<AssessmentView>("/results/assessments", input);
}

export function getAssessment(id: string): Promise<AssessmentDetail> {
  return get<AssessmentDetail>(`/results/assessments/${enc(id)}`);
}

export function setAssessmentScores(
  id: string,
  scores: { studentId: string; score: number | null; absent: boolean; comment?: string }[],
): Promise<AssessmentDetail> {
  return call<AssessmentDetail>(`/results/assessments/${enc(id)}/scores`, { method: "PUT", body: JSON.stringify({ scores }) }, true);
}

export function publishAssessment(id: string): Promise<{ ok: boolean; familiesNotified: number }> {
  return post<{ ok: boolean; familiesNotified: number }>(`/results/assessments/${enc(id)}/publish`);
}

export function deleteAssessment(id: string): Promise<{ ok: boolean }> {
  return call<{ ok: boolean }>(`/results/assessments/${enc(id)}`, { method: "DELETE" }, true);
}

export function getChildResults(studentId: string): Promise<{ items: PublishedResult[] }> {
  return get<{ items: PublishedResult[] }>(`/family/children/${enc(studentId)}/results`);
}

/* --- t92 (CDC 3.2 / 3.5 / 5) : circuits de transport --------------------- */

export function listCircuits(): Promise<{ circuits: BusCircuitView[] }> {
  return get<{ circuits: BusCircuitView[] }>("/bus/circuits");
}

export function listBusAttendants(): Promise<{ attendants: { id: string; displayName: string }[] }> {
  return get<{ attendants: { id: string; displayName: string }[] }>("/bus/attendants");
}

export function createCircuit(input: { name: string; attendantProfileId?: string }): Promise<BusCircuitView> {
  return post<BusCircuitView>("/bus/circuits", input);
}

export function updateCircuit(id: string, input: { name?: string; attendantProfileId?: string | null; active?: boolean }): Promise<BusCircuitView> {
  return patch<BusCircuitView>(`/bus/circuits/${enc(id)}`, input);
}

export function addCircuitStop(id: string, name: string): Promise<BusCircuitView> {
  return post<BusCircuitView>(`/bus/circuits/${enc(id)}/stops`, { name });
}

export function setCircuitStudents(id: string, students: { studentId: string; stopId?: string }[]): Promise<CircuitRoadmap> {
  return call<CircuitRoadmap>(`/bus/circuits/${enc(id)}/students`, { method: "PUT", body: JSON.stringify({ students }) }, true);
}

export function getCircuitRoadmap(id: string, date?: string): Promise<CircuitRoadmap> {
  return get<CircuitRoadmap>(`/bus/circuits/${enc(id)}/roadmap${date ? `?date=${enc(date)}` : ""}`);
}

export function setBusStatus(input: { studentId: string; status: string; date?: string }): Promise<unknown> {
  return post<unknown>("/bus/status", input);
}

/* --- Transport Scolaire : Suivi en direct (GPS, Écran chauffeur, Carte parent) --- */

export type ParentChildTripView = {
  enrolled: boolean;
  student: { id: string; displayName?: string } | null;
  circuit?: { id: string; name: string };
  assignedStop?: { id: string; name: string; latitude: number | null; longitude: number | null; address: string | null };
  schoolLocation?: { name: string; latitude: number; longitude: number };
  trip?: {
    id: string;
    direction: "pickup" | "dropoff";
    startedAt: string | null;
    status: "planned" | "in_progress" | "completed" | "cancelled";
    vehicle?: { plateNumber: string; model: string | null } | null;
    latestPosition?: { latitude: number; longitude: number; speed: number | null; heading: number | null; accuracy: number | null; recordedAt: string } | null;
    etaMinutes: number | null;
    distanceMeters: number | null;
  } | null;
  notice: string;
};

export type DriverSessionView = {
  activeTrip: {
    id: string;
    circuitId: string;
    circuitName: string;
    direction: "pickup" | "dropoff";
    startedAt: string;
    vehicle?: { plateNumber: string; model: string | null } | null;
    stops: Array<{
      id: string;
      name: string;
      position: number;
      latitude: number | null;
      longitude: number | null;
      address: string | null;
      radiusMeters: number;
      students: Array<{ id: string; displayName: string; code: string }>;
    }>;
    lastPosition?: { latitude: number; longitude: number; speed: number | null; heading: number | null } | null;
    stopEvents: Array<{ id: string; stopId: string; eventType: string; recordedAt: string }>;
  } | null;
  circuits: Array<{
    id: string;
    name: string;
    stopCount: number;
    studentCount: number;
    vehicle?: { plateNumber: string } | null;
  }>;
  vehicles: Array<{ id: string; plateNumber: string; model: string | null; capacity: number | null }>;
};

export type FleetOverviewView = {
  school: { id: string; name: string; transportTrackingEnabled: boolean; latitude: number | null; longitude: number | null };
  activeTrips: Array<{
    id: string;
    circuitName: string;
    direction: "pickup" | "dropoff";
    driverName: string;
    vehiclePlate: string;
    startedAt: string;
    latestPosition?: { latitude: number; longitude: number; speed: number | null; heading: number | null; recordedAt: string } | null;
    stopCount: number;
  }>;
  circuits: Array<{
    id: string;
    name: string;
    active: boolean;
    color: string | null;
    attendant: string | null;
    vehicle?: { plateNumber: string } | null;
    stops: Array<{ id: string; name: string; position: number; latitude: number | null; longitude: number | null; address: string | null }>;
    studentCount: number;
  }>;
  vehicles: Array<{ id: string; plateNumber: string; model: string | null; capacity: number | null }>;
};

export function getParentChildTrip(studentId: string): Promise<ParentChildTripView> {
  return get<ParentChildTripView>(`/transport/parent/child/${enc(studentId)}`);
}

export function shareParentLocation(
  studentId: string,
  input: { latitude: number; longitude: number; address?: string; relocateDemoSchool?: boolean },
): Promise<{ ok: boolean; message: string; stop: { id: string; name: string; latitude: number; longitude: number; address?: string } }> {
  return post<{ ok: boolean; message: string; stop: { id: string; name: string; latitude: number; longitude: number; address?: string } }>(
    `/transport/parent/child/${enc(studentId)}/share-location`,
    input,
  );
}

export function getDriverSession(): Promise<DriverSessionView> {
  return get<DriverSessionView>("/transport/driver/session");
}

export function startTrip(input: { circuitId: string; direction: "pickup" | "dropoff"; vehicleId?: string; notes?: string }): Promise<{ id: string }> {
  return post<{ id: string }>("/transport/trips/start", input);
}

export function ingestTripPositions(
  tripId: string,
  positions: Array<{ latitude: number; longitude: number; speed?: number; heading?: number; accuracy?: number; recordedAt?: string }>,
): Promise<{ ok: boolean; count: number; etaByStop?: Record<string, { etaMinutes: number; distanceMeters: number }> }> {
  return post(`/transport/trips/${enc(tripId)}/positions`, { positions });
}

export function recordTripStopEvent(
  tripId: string,
  input: { stopId: string; eventType: "arrived" | "departed" | "students_dropped" },
): Promise<{ id: string }> {
  return post<{ id: string }>(`/transport/trips/${enc(tripId)}/stop-event`, input);
}

export function endTrip(tripId: string): Promise<{ ok: boolean; status: string; endedAt: string }> {
  return post(`/transport/trips/${enc(tripId)}/end`, {});
}

export function getFleetOverview(): Promise<FleetOverviewView> {
  return get<FleetOverviewView>("/transport/admin/fleet");
}

export function updateStopCoordinates(
  stopId: string,
  input: { latitude: number; longitude: number; address?: string; radiusMeters?: number },
): Promise<unknown> {
  return post(`/transport/admin/stops/${enc(stopId)}/location`, input);
}

export function createTransportVehicle(input: { plateNumber: string; model?: string; capacity?: number }): Promise<unknown> {
  return post("/transport/admin/vehicles", input);
}

export function toggleTransportTracking(enabled: boolean): Promise<{ transportTrackingEnabled: boolean }> {
  return post("/transport/admin/toggle", { enabled });
}

export function getTransportNotice(): Promise<{ fr: string; ar: string; retentionDays: number }> {
  return get("/transport/notice");
}
