"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  closeSession,
  describeError,
  getRoster,
  getSession,
  markRows,
  reopenSession,
  sessionHistory,
} from "@/lib/api";
import {
  SLOT_LABEL,
  STATUS_LABEL,
  formatCivilDate,
  formatDate,
  historyActionLabel,
  roleLabel,
} from "@/lib/labels";
import {
  deleteSnapshot,
  enqueue,
  isOnline,
  newMutationId,
  pendingFor,
  readSnapshot,
  registerAttendanceWorker,
  saveSnapshot,
  syncSession,
  type QueuedMutation,
} from "@/lib/offline-attendance";
import { useActiveProfile } from "@/lib/session";
import type { AttendanceStatus, HistoryEntry, RosterStudent, SessionDetail } from "@/lib/types";

const STATUSES: AttendanceStatus[] = ["present", "absent", "late"];
type Filter = "all" | "unmarked" | AttendanceStatus;

type Notice = { tone: "ok" | "error" | "warn"; text: string } | null;

/**
 * Lot 2.3 : écran d'appel d'une session (matin ou après-midi).
 * Les statuts sont saisis localement puis enregistrés en un envoi groupé
 * (POST rows/bulk). Session clôturée : lecture seule ; réouverture direction.
 *
 * ADR-003 (t89) : hors ligne, chaque changement de statut est placé dans une file
 * IndexedDB (UUID de l'appareil, heure de saisie), puis rejoué automatiquement sur
 * POST sessions/:id/sync (retour du réseau, retour au premier plan, toutes les 30 s).
 * Résultats « stale », « rejected » et « closed » affichés ; indicateur de synchronisation.
 */
export default function SessionPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;
  const profile = useActiveProfile();
  const isDirection = profile?.role === "direction";

  const [session, setSession] = useState<SessionDetail | null>(null);
  const [students, setStudents] = useState<RosterStudent[]>([]);
  const [saved, setSaved] = useState<Record<string, AttendanceStatus>>({});
  const [draft, setDraft] = useState<Record<string, AttendanceStatus>>({});
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [fatal, setFatal] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [dialog, setDialog] = useState<"close" | "reopen" | null>(null);
  const [reason, setReason] = useState("");
  const [online, setOnline] = useState(true);
  const [queued, setQueued] = useState<QueuedMutation[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [lostOnClose, setLostOnClose] = useState(0);
  const [offlineCopy, setOfflineCopy] = useState<string | null>(null);
  const [historyOffline, setHistoryOffline] = useState(false);
  const draftRef = useRef(draft);
  const savedRef = useRef(saved);
  const syncingRef = useRef(false);
  useEffect(() => {
    draftRef.current = draft;
    savedRef.current = saved;
  }, [draft, saved]);

  const refreshQueue = useCallback(async () => {
    setQueued(await pendingFor(sessionId).catch(() => []));
  }, [sessionId]);

  const loadHistory = useCallback(async () => {
    try {
      setHistory(await sessionHistory(sessionId));
      setHistoryError(null);
      setHistoryOffline(false);
    } catch (cause) {
      if (cause instanceof TypeError) {
        setHistoryOffline(true);
        setHistoryError(null);
      } else {
        setHistoryError(describeError(cause));
      }
    }
  }, [sessionId]);

  const load = useCallback(
    async (keepDirty = false) => {
      try {
        const detail = await getSession(sessionId);
        const roster = await getRoster(detail.classroomId, detail.date.slice(0, 10));
        const current: Record<string, AttendanceStatus> = {};
        for (const row of detail.rows) {
          current[row.studentId] = row.status;
        }
        const next = { ...current };
        if (keepDirty) {
          // Les saisies en ligne non encore enregistrées survivent au rechargement après synchronisation.
          for (const [studentId, status] of Object.entries(draftRef.current)) {
            if (status !== savedRef.current[studentId]) next[studentId] = status;
          }
        }
        setSession(detail);
        setStudents(roster.students);
        setSaved(current);
        setDraft(next);
        setSelection(new Set());
        setFatal(null);
        setOfflineCopy(null);
        // Copie locale minimale pour l'appel hors ligne ; purgée dès la clôture.
        if (detail.status === "closed") {
          void deleteSnapshot(sessionId).catch(() => undefined);
        } else {
          void saveSnapshot({ sessionId, detail, students: roster.students, savedAt: new Date().toISOString() }).catch(
            () => undefined,
          );
        }
      } catch (cause) {
        const snapshot = cause instanceof TypeError ? await readSnapshot(sessionId).catch(() => undefined) : undefined;
        if (snapshot) {
          const current: Record<string, AttendanceStatus> = {};
          for (const row of snapshot.detail.rows) {
            current[row.studentId] = row.status;
          }
          setSession(snapshot.detail);
          setStudents(snapshot.students);
          setSaved(current);
          setDraft(current);
          setFatal(null);
          setOfflineCopy(snapshot.savedAt);
        } else {
          setFatal(describeError(cause));
        }
      } finally {
        setLoading(false);
      }
      await refreshQueue();
      void loadHistory();
    },
    [sessionId, loadHistory, refreshQueue],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const closed = session?.status === "closed";
  const dirtyIds = useMemo(
    () => Object.keys(draft).filter((studentId) => draft[studentId] !== saved[studentId]),
    [draft, saved],
  );
  const dirty = dirtyIds.length > 0;

  /** Dernier statut en file (hors ligne) par élève. */
  const queuedFor = useMemo(() => {
    const result: Record<string, AttendanceStatus> = {};
    for (const mutation of queued) result[mutation.studentId] = mutation.status;
    return result;
  }, [queued]);

  /** Statut affiché : saisie en ligne non enregistrée, sinon file hors ligne, sinon serveur. */
  const effective = useMemo(() => {
    const result: Record<string, AttendanceStatus> = { ...saved, ...queuedFor };
    for (const studentId of Object.keys(draft)) {
      if (draft[studentId] !== saved[studentId]) result[studentId] = draft[studentId];
    }
    return result;
  }, [saved, draft, queuedFor]);

  /** Place des changements dans la file IndexedDB (aucun envoi tant que le réseau est absent). */
  const queueChanges = useCallback(
    async (changes: { studentId: string; status: AttendanceStatus }[]) => {
      if (changes.length === 0) return;
      const recordedAt = new Date().toISOString();
      await enqueue(
        changes.map((change) => ({
          clientMutationId: newMutationId(),
          sessionId,
          studentId: change.studentId,
          status: change.status,
          recordedAt,
        })),
      );
      setDraft((previous) => {
        const next = { ...previous };
        for (const change of changes) {
          const server = savedRef.current[change.studentId];
          if (server) next[change.studentId] = server;
          else delete next[change.studentId];
        }
        return next;
      });
      await refreshQueue();
    },
    [sessionId, refreshQueue],
  );

  const syncNow = useCallback(async () => {
    if (syncingRef.current || !isOnline()) return;
    const pending = await pendingFor(sessionId).catch(() => []);
    if (pending.length === 0) {
      setQueued([]);
      return;
    }
    syncingRef.current = true;
    setSyncing(true);
    try {
      const outcome = await syncSession(sessionId);
      const parts: string[] = [];
      if (outcome.rejected.length > 0) {
        parts.push(`${outcome.rejected.length} modification(s) refusée(s) : ${outcome.rejected[0].message}.`);
      }
      if (outcome.stale > 0) {
        parts.push(
          `${outcome.stale} modification(s) ignorée(s) : une saisie plus récente existe sur le serveur (le dernier enregistrement gagne).`,
        );
      }
      if (outcome.closed > 0) {
        setLostOnClose((previous) => previous + outcome.closed);
        parts.push(`Appel clôturé pendant la coupure : ${outcome.closed} modification(s) non appliquée(s).`);
      }
      setNotice(
        parts.length > 0
          ? { tone: outcome.rejected.length > 0 ? "error" : "warn", text: parts.join(" ") }
          : {
              tone: "ok",
              text: `Synchronisation terminée : ${outcome.applied + outcome.duplicate} modification(s) enregistrée(s).`,
            },
      );
      await load(true);
    } catch (cause) {
      await refreshQueue();
      if (!(cause instanceof TypeError)) {
        setNotice({ tone: "error", text: `Synchronisation impossible : ${describeError(cause)}` });
      }
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }, [sessionId, load, refreshQueue]);

  // Service worker (portée /attendance) : coquille disponible sans réseau.
  useEffect(() => {
    void registerAttendanceWorker();
  }, []);

  // Reprise : retour du réseau, retour au premier plan.
  useEffect(() => {
    setOnline(isOnline());
    const goOnline = () => {
      setOnline(true);
      void syncNow();
    };
    const goOffline = () => setOnline(false);
    const onVisible = () => {
      if (document.visibilityState === "visible") void syncNow();
    };
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [syncNow]);

  // Reprise périodique (30 s) tant que la file n'est pas vide.
  useEffect(() => {
    if (queued.length === 0) return;
    const timer = window.setInterval(() => void syncNow(), 30_000);
    return () => window.clearInterval(timer);
  }, [queued.length, syncNow]);

  // Premier chargement terminé : on rejoue une file laissée par une visite précédente.
  const initialSyncDone = useRef(false);
  useEffect(() => {
    if (loading || initialSyncDone.current) return;
    initialSyncDone.current = true;
    void syncNow();
  }, [loading, syncNow]);

  // Prévenir la perte de saisie à la fermeture de l'onglet.
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const counts = useMemo(() => {
    const result = { present: 0, absent: 0, late: 0, unmarked: 0 };
    for (const student of students) {
      const status = effective[student.id];
      if (status) result[status] += 1;
      else result.unmarked += 1;
    }
    return result;
  }, [effective, students]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return students.filter((student) => {
      const status = effective[student.id];
      if (filter === "unmarked" && status) return false;
      if (filter !== "all" && filter !== "unmarked" && status !== filter) return false;
      if (!needle) return true;
      return (
        student.displayName.toLowerCase().includes(needle) ||
        student.studentCode.toLowerCase().includes(needle)
      );
    });
  }, [students, effective, filter, search]);

  const setStatus = (studentId: string, status: AttendanceStatus) => {
    if (closed) return;
    setNotice(null);
    if (!isOnline()) {
      void queueChanges([{ studentId, status }]);
      return;
    }
    setDraft((previous) => ({ ...previous, [studentId]: status }));
  };

  const applyBulk = (status: AttendanceStatus, scope: "selection" | "unmarked" | "all") => {
    if (closed) return;
    const changes = students
      .filter((student) => !(scope === "selection" && !selection.has(student.id)))
      .filter((student) => !(scope === "unmarked" && effective[student.id]))
      .map((student) => ({ studentId: student.id, status }));
    if (scope === "selection") setSelection(new Set());
    setNotice(null);
    if (!isOnline()) {
      void queueChanges(changes);
      return;
    }
    setDraft((previous) => {
      const next = { ...previous };
      for (const change of changes) next[change.studentId] = status;
      return next;
    });
  };

  const toggleSelected = (studentId: string) => {
    setSelection((previous) => {
      const next = new Set(previous);
      if (next.has(studentId)) next.delete(studentId);
      else next.add(studentId);
      return next;
    });
  };

  const allVisibleSelected = visible.length > 0 && visible.every((student) => selection.has(student.id));
  const toggleAllVisible = () => {
    setSelection((previous) => {
      const next = new Set(previous);
      if (allVisibleSelected) visible.forEach((student) => next.delete(student.id));
      else visible.forEach((student) => next.add(student.id));
      return next;
    });
  };

  const save = useCallback(async (): Promise<boolean> => {
    if (!session || !dirty) return true;
    setBusy(true);
    try {
      const rows = dirtyIds.map((studentId) => ({ studentId, status: draft[studentId] }));
      const result = await markRows(session.id, rows);
      const rejected = new Set(result.rejected.map((entry) => entry.studentId));
      setSaved((previous) => {
        const next = { ...previous };
        for (const row of rows) {
          if (!rejected.has(row.studentId)) next[row.studentId] = row.status;
        }
        return next;
      });
      setNotice(
        result.rejected.length > 0
          ? {
              tone: "warn",
              text: `${result.accepted} enregistrement(s), ${result.rejected.length} refusé(s) : ${result.rejected[0].message}.`,
            }
          : { tone: "ok", text: `Appel enregistré : ${result.accepted} élève(s) mis à jour.` },
      );
      void loadHistory();
      return result.rejected.length === 0;
    } catch (cause) {
      if (cause instanceof TypeError) {
        // ADR-003 : réseau perdu pendant l'envoi, la saisie part dans la file hors ligne.
        const rows = dirtyIds.map((studentId) => ({ studentId, status: draft[studentId] }));
        await queueChanges(rows);
        setNotice({
          tone: "warn",
          text: `Connexion perdue : ${rows.length} modification(s) conservée(s) sur l'appareil, envoi automatique au retour du réseau.`,
        });
        return false;
      }
      if (cause instanceof ApiError && cause.status === 409) {
        // Session clôturée par un autre utilisateur : on recharge l'état réel.
        await load();
      }
      setNotice({ tone: "error", text: describeError(cause) });
      return false;
    } finally {
      setBusy(false);
    }
  }, [session, dirty, dirtyIds, draft, load, loadHistory, queueChanges]);

  const confirmClose = async () => {
    if (!session) return;
    setBusy(true);
    try {
      if (dirty) {
        const ok = await save();
        if (!ok) {
          setBusy(false);
          return;
        }
        setBusy(true);
      }
      await closeSession(session.id);
      setDialog(null);
      await load();
      setNotice({ tone: "ok", text: "Appel clôturé. Les présences ne sont plus modifiables." });
    } catch (cause) {
      setNotice({ tone: "error", text: describeError(cause) });
      setDialog(null);
      if (cause instanceof ApiError && cause.status === 409) await load();
    } finally {
      setBusy(false);
    }
  };

  const confirmReopen = async () => {
    if (!session) return;
    const trimmed = reason.trim();
    if (trimmed.length < 3) {
      setNotice({ tone: "error", text: "Le motif de réouverture doit contenir au moins 3 caractères." });
      return;
    }
    setBusy(true);
    try {
      await reopenSession(session.id, trimmed);
      setDialog(null);
      setReason("");
      await load();
      setNotice({ tone: "ok", text: "Appel rouvert. La réouverture est tracée dans l'historique." });
    } catch (cause) {
      setNotice({ tone: "error", text: describeError(cause) });
    } finally {
      setBusy(false);
    }
  };

  const pendingCount = queued.length;
  const syncText =
    closed && lostOnClose > 0
      ? `Appel clôturé : ${lostOnClose} modification(s) non appliquée(s)`
      : syncing
        ? "Synchronisation…"
        : !online
          ? pendingCount > 0
            ? `Hors ligne – ${pendingCount} modification(s) en attente`
            : "Hors ligne – les modifications restent sur l'appareil"
          : pendingCount > 0
            ? `${pendingCount} modification(s) en attente d'envoi`
            : "À jour";
  const syncOk = online && !syncing && pendingCount === 0 && !(closed && lostOnClose > 0);

  if (loading) {
    return (
      <main className="page">
        <p className="muted">Chargement de l&apos;appel…</p>
      </main>
    );
  }

  if (fatal || !session) {
    return (
      <main className="page stack">
        <p className="alert alert--error" role="alert">
          {fatal ?? "Appel introuvable."}
        </p>
        <Link className="btn" href="/attendance">
          Retour aux présences
        </Link>
      </main>
    );
  }

  return (
    <main className="page stack">
      <div className="page-head">
        <div>
          <Link className="muted" href="/attendance">
            ← Présences
          </Link>
          <h1 className="h1" style={{ marginTop: 4 }}>
            {session.classroom.name} · {SLOT_LABEL[session.slot]}
          </h1>
          <p className="subtitle" style={{ textTransform: "capitalize" }}>
            {formatCivilDate(session.date)}
          </p>
        </div>
        <div className="row">
          <span
            className={syncOk ? "badge badge--active" : "badge badge--muted"}
            data-testid="sync-indicator"
            role="status"
            aria-live="polite"
            aria-label="Synchronisation de l'appel"
          >
            {syncText}
          </span>
          <span className={closed ? "badge badge--muted" : "badge badge--active"}>
            {closed ? "Clôturé" : "Appel en cours"}
          </span>
          {closed && isDirection ? (
            <button className="btn" type="button" onClick={() => setDialog("reopen")} disabled={busy}>
              Rouvrir l&apos;appel
            </button>
          ) : null}
        </div>
      </div>

      {closed ? (
        <div className="alert alert--warn" role="status">
          Appel clôturé{session.closedAt ? ` le ${formatDate(session.closedAt)}` : ""}. Lecture seule
          {isDirection ? " : la direction peut le rouvrir avec un motif." : " : seule la direction peut le rouvrir."}
        </div>
      ) : null}
      {!closed && session.reopenReason ? (
        <div className="alert" role="status">
          Rouvert{session.reopenedAt ? ` le ${formatDate(session.reopenedAt)}` : ""} · motif : {session.reopenReason}
        </div>
      ) : null}

      {offlineCopy ? (
        <p className="alert" role="status">
          Hors ligne : liste de classe enregistrée sur cet appareil le {formatDate(offlineCopy)}. Les modifications
          seront envoyées au retour du réseau.
        </p>
      ) : null}

      {notice ? (
        <p className={`alert alert--${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}>
          {notice.text}
        </p>
      ) : null}

      <div className="two-col">
        <section className="card stack" aria-labelledby="roster-title">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2 className="h2" id="roster-title">
              Élèves ({students.length})
            </h2>
            <div className="stats" aria-label="Récapitulatif">
              <span className="stat"><span className="dot dot--present" />{counts.present} présents</span>
              <span className="stat"><span className="dot dot--absent" />{counts.absent} absents</span>
              <span className="stat"><span className="dot dot--late" />{counts.late} retards</span>
              <span className="stat"><span className="dot" />{counts.unmarked} non marqués</span>
            </div>
          </div>

          <div className="filters">
            <label className="field">
              <span className="label">Rechercher</span>
              <input
                className="input"
                type="search"
                placeholder="Nom ou code élève"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <label className="field">
              <span className="label">Afficher</span>
              <select className="select" value={filter} onChange={(event) => setFilter(event.target.value as Filter)}>
                <option value="all">Tous les élèves</option>
                <option value="unmarked">Non marqués</option>
                <option value="present">Présents</option>
                <option value="absent">Absents</option>
                <option value="late">Retards</option>
              </select>
            </label>
          </div>

          {!closed && students.length > 0 ? (
            <div className="row">
              <button className="btn btn--teal" type="button" onClick={() => applyBulk("present", "unmarked")}>
                Non marqués → présents
              </button>
              <button className="btn" type="button" onClick={() => applyBulk("present", "all")}>
                Tous présents
              </button>
              <label className="row" style={{ gap: 8 }}>
                <input
                  className="checkbox"
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={toggleAllVisible}
                  aria-label="Sélectionner les élèves affichés"
                />
                <span className="muted">Sélection ({selection.size})</span>
              </label>
              {selection.size > 0
                ? STATUSES.map((status) => (
                    <button
                      key={status}
                      className="btn"
                      type="button"
                      onClick={() => applyBulk(status, "selection")}
                    >
                      Sélection → {STATUS_LABEL[status].toLowerCase()}
                    </button>
                  ))
                : null}
            </div>
          ) : null}

          {students.length === 0 ? (
            <div className="alert alert--warn" role="status">
              Aucun élève inscrit dans cette classe pour l&apos;année {session.schoolYear}.
            </div>
          ) : null}

          <ul className="roster list-reset">
            {visible.map((student) => {
              const current = effective[student.id];
              const isDirty = draft[student.id] !== saved[student.id];
              const isQueued = !isDirty && queuedFor[student.id] !== undefined;
              return (
                <li key={student.id} className={isDirty || isQueued ? "roster__item roster__item--dirty" : "roster__item"}>
                  <div className="roster__who">
                    {!closed ? (
                      <input
                        className="checkbox"
                        type="checkbox"
                        checked={selection.has(student.id)}
                        onChange={() => toggleSelected(student.id)}
                        aria-label={`Sélectionner ${student.displayName}`}
                      />
                    ) : (
                      <span className={`dot ${current ? `dot--${current}` : ""}`} aria-hidden="true" />
                    )}
                    <div>
                      <div className="roster__name">{student.displayName}</div>
                      <div className="muted mono">
                        {student.studentCode}
                        {isDirty ? " · modifié, non enregistré" : ""}
                        {isQueued ? " · en attente de synchronisation" : ""}
                        {!current ? " · non marqué" : ""}
                      </div>
                    </div>
                  </div>
                  <div className="status-group" role="group" aria-label={`Statut de ${student.displayName}`}>
                    {STATUSES.map((status) => (
                      <button
                        key={status}
                        type="button"
                        className={`status-btn status-btn--${status}`}
                        aria-pressed={current === status}
                        disabled={closed || busy}
                        onClick={() => setStatus(student.id, status)}
                      >
                        {STATUS_LABEL[status]}
                      </button>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
          {visible.length === 0 && students.length > 0 ? (
            <p className="muted">Aucun élève ne correspond au filtre.</p>
          ) : null}
        </section>

        <section className="card stack" aria-labelledby="history-title">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2 className="h2" id="history-title">
              Historique
            </h2>
            <button className="btn btn--ghost" type="button" onClick={() => void loadHistory()}>
              Actualiser
            </button>
          </div>
          {historyError ? <p className="alert alert--error">{historyError}</p> : null}
          {historyOffline ? <p className="muted">Historique indisponible hors ligne.</p> : null}
          <ol className="timeline">
            {[...history].reverse().map((entry) => (
              <li
                key={entry.id}
                className={`timeline__item${
                  entry.severity === "critical"
                    ? " timeline__item--critical"
                    : entry.severity === "warning"
                      ? " timeline__item--warning"
                      : ""
                }`}
              >
                <strong>{historyActionLabel(entry.action)}</strong>
                <div className="muted">
                  {formatDate(entry.createdAt)}
                  {entry.actor ? ` · ${entry.actor.displayName} (${roleLabel(entry.actor.role)})` : ""}
                </div>
                {entry.reason ? <div>Motif : {entry.reason}</div> : null}
                {entry.changes.length > 0 ? (
                  <details>
                    <summary className="muted">
                      {entry.changes.length} changement{entry.changes.length > 1 ? "s" : ""}
                    </summary>
                    <ul className="list-reset" style={{ fontSize: 14 }}>
                      {entry.changes.map((change) => (
                        <li key={`${entry.id}-${change.studentId}`}>
                          {change.studentName ?? change.studentCode ?? "Élève"} :{" "}
                          {change.from ? STATUS_LABEL[change.from] : "non marqué"} → {STATUS_LABEL[change.to]}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : entry.action === "attendance.rows.recorded" && entry.accepted !== null ? (
                  <div className="muted">{entry.accepted} ligne(s) sans changement de statut</div>
                ) : null}
              </li>
            ))}
          </ol>
          {history.length === 0 && !historyError && !historyOffline ? <p className="muted">Aucun événement pour l&apos;instant.</p> : null}
        </section>
      </div>

      {!closed ? (
        <div className="action-bar">
          <span className="muted">
            {dirty
              ? `${dirtyIds.length} modification(s) non enregistrée(s)`
              : counts.unmarked > 0
                ? `${counts.unmarked} élève(s) encore à marquer`
                : "Tous les élèves sont marqués"}
          </span>
          <div className="row">
            <button className="btn" type="button" disabled={busy} onClick={() => setDialog("close")}>
              Clôturer l&apos;appel
            </button>
            <button className="btn btn--primary" type="button" disabled={busy || !dirty} onClick={() => void save()}>
              {busy ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>
        </div>
      ) : null}

      {dialog ? (
        <div className="modal-backdrop" role="presentation" onClick={() => !busy && setDialog(null)}>
          <div
            className="card modal stack"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dialog-title"
            onClick={(event) => event.stopPropagation()}
          >
            {dialog === "close" ? (
              <>
                <h2 className="h2" id="dialog-title">
                  Clôturer l&apos;appel ?
                </h2>
                <p style={{ margin: 0 }}>
                  Après clôture, les présences ne sont plus modifiables. Seule la direction pourra rouvrir
                  l&apos;appel, avec un motif.
                </p>
                {dirty ? (
                  <p className="alert">Les {dirtyIds.length} modification(s) en cours seront enregistrées d&apos;abord.</p>
                ) : null}
                {counts.unmarked > 0 ? (
                  <p className="alert alert--warn">
                    Attention : {counts.unmarked} élève(s) ne sont pas marqués.
                  </p>
                ) : null}
                <div className="row" style={{ justifyContent: "flex-end" }}>
                  <button className="btn" type="button" disabled={busy} onClick={() => setDialog(null)}>
                    Annuler
                  </button>
                  <button className="btn btn--primary" type="button" disabled={busy} onClick={() => void confirmClose()}>
                    {busy ? "Clôture…" : "Clôturer"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2 className="h2" id="dialog-title">
                  Rouvrir l&apos;appel
                </h2>
                <p style={{ margin: 0 }} className="muted">
                  La réouverture est tracée dans le journal d&apos;audit avec votre nom et le motif.
                </p>
                <label className="field">
                  <span className="label">Motif (obligatoire)</span>
                  <textarea
                    className="textarea"
                    value={reason}
                    maxLength={500}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="Ex. : erreur de saisie signalée par l'enseignant"
                  />
                  <span className="hint">{reason.trim().length} / 500 caractères (3 minimum)</span>
                </label>
                <div className="row" style={{ justifyContent: "flex-end" }}>
                  <button className="btn" type="button" disabled={busy} onClick={() => setDialog(null)}>
                    Annuler
                  </button>
                  <button
                    className="btn btn--primary"
                    type="button"
                    disabled={busy || reason.trim().length < 3}
                    onClick={() => void confirmReopen()}
                  >
                    {busy ? "Réouverture…" : "Rouvrir"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </main>
  );
}
