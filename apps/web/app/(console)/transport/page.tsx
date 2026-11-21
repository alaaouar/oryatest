"use client";

import Image from "next/image";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  addCircuitStop,
  createCircuit,
  describeError,
  getCircuitRoadmap,
  listBusAttendants,
  listCircuits,
  listStudents,
  setBusStatus,
  setCircuitStudents,
  updateCircuit,
} from "@/lib/api";
import { formatCivilDate } from "@/lib/labels";
import { useActiveProfile } from "@/lib/session";
import type { BusCircuitView, CircuitRoadmap, RoadmapStudent, StudentListRow } from "@/lib/types";
import { DriverLiveConsole } from "@/components/DriverLiveConsole";
import { FleetLiveMap } from "@/components/FleetLiveMap";

type Notice = { tone: "ok" | "error"; text: string } | null;
const ONE_TAP: { status: "on_board" | "dropped_off" | "absent"; label: string }[] = [
  { status: "on_board", label: "Monté" },
  { status: "dropped_off", label: "Déposé" },
  { status: "absent", label: "Absent" },
];

type AdminViewTab = "fleet" | "circuits" | "driver";

export default function TransportPage() {
  const profile = useActiveProfile();
  const isDirection = profile?.role === "direction" || profile?.role === "super_admin";
  const isChauffeur = profile?.role === "chauffeur";
  const isAttendant = profile?.role === "bus_attendant";
  const allowed = isDirection || isChauffeur || isAttendant;

  // Si rôle chauffeur pur -> vue mobile-first immédiate
  const [adminTab, setAdminTab] = useState<AdminViewTab>(
    isChauffeur ? "driver" : isAttendant ? "driver" : "fleet",
  );

  const [circuits, setCircuits] = useState<BusCircuitView[]>([]);
  const [attendants, setAttendants] = useState<{ id: string; displayName: string }[]>([]);
  const [roadmap, setRoadmap] = useState<CircuitRoadmap | null>(null);
  const [name, setName] = useState("");
  const [attendantId, setAttendantId] = useState("");
  const [stopName, setStopName] = useState("");
  const [search, setSearch] = useState("");
  const [found, setFound] = useState<StudentListRow[]>([]);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const data = await listCircuits();
    setCircuits(data.circuits);
    if (isDirection) setAttendants((await listBusAttendants()).attendants);
  }, [isDirection]);

  useEffect(() => {
    if (!allowed) return;
    load().catch((cause) => setNotice({ tone: "error", text: describeError(cause) }));
  }, [allowed, load]);

  async function run(action: () => Promise<void>, ok?: string) {
    setBusy(true);
    setNotice(null);
    try {
      await action();
      if (ok) setNotice({ tone: "ok", text: ok });
    } catch (cause) {
      setNotice({ tone: "error", text: describeError(cause) });
    } finally {
      setBusy(false);
    }
  }

  const open = (id: string) => run(async () => setRoadmap(await getCircuitRoadmap(id)));

  function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(async () => {
      const created = await createCircuit({ name: name.trim(), attendantProfileId: attendantId || undefined });
      setName("");
      await load();
      setRoadmap(await getCircuitRoadmap(created.id));
    }, "Circuit créé.");
  }

  function onAddStop(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!roadmap) return;
    void run(async () => {
      await addCircuitStop(roadmap.circuit.id, stopName.trim());
      setStopName("");
      setRoadmap(await getCircuitRoadmap(roadmap.circuit.id));
    }, "Arrêt ajouté.");
  }

  function tap(studentId: string, status: "on_board" | "dropped_off" | "absent") {
    if (!roadmap) return;
    void run(async () => {
      await setBusStatus({ studentId, status, date: roadmap.date });
      setRoadmap(await getCircuitRoadmap(roadmap.circuit.id, roadmap.date));
    });
  }

  function addStudent(studentId: string) {
    if (!roadmap) return;
    const current = roadmap.stops.flatMap((s) => s.students.map((st) => ({ studentId: st.id, stopId: s.id })));
    current.push({ studentId, stopId: roadmap.stops[0]?.id });
    void run(async () => {
      setRoadmap(await setCircuitStudents(roadmap.circuit.id, current));
      setFound([]);
      setSearch("");
      await load();
    }, "Élève rattaché.");
  }

  function removeStudent(studentId: string) {
    if (!roadmap) return;
    const current = roadmap.stops
      .flatMap((s) => s.students.map((st) => ({ studentId: st.id, stopId: s.id })))
      .filter((entry) => entry.studentId !== studentId);
    void run(async () => {
      setRoadmap(await setCircuitStudents(roadmap.circuit.id, current));
      await load();
    }, "Élève retiré du circuit.");
  }

  if (!allowed) {
    return (
      <main className="console-content stack">
        <div className="alert alert--warn">Cet espace est réservé aux chauffeurs et à l&apos;équipe de direction.</div>
      </main>
    );
  }

  const rows: { key: string; title: string; students: RoadmapStudent[] }[] = roadmap
    ? [
        ...roadmap.stops.map((s) => ({ key: s.id, title: `${s.position}. ${s.name}`, students: s.students })),
        { key: "none", title: "Sans arrêt défini", students: roadmap.withoutStop },
      ]
    : [];

  return (
    <main className="console-content stack transport-page">
      <header className="stack transport-page__header">
        <h1 className="h1">Transport scolaire</h1>
        <p className="muted">
          {isChauffeur
            ? "Console mobile chauffeur : gestion de tournée et partage GPS en direct."
            : isDirection
            ? "Supervision cartographique en temps réel, circuits et console chauffeur."
            : "Feuille de route et suivi des élèves."}
        </p>
      </header>

      {/* Onglets pour la Direction ou l'Accompagnateur */}
      {isDirection || isAttendant ? (
        <div className="seg transport-page__tabs" role="tablist" aria-label="Sous-sections transport">
          {isDirection ? (
            <button
              type="button"
              role="tab"
              className="seg__btn"
              aria-selected={adminTab === "fleet"}
              onClick={() => setAdminTab("fleet")}
            >
              <><Image src="/map.svg" alt="" aria-hidden width={18} height={18} className="svg-icon svg-icon--inline" />Flotte en direct</>
            </button>
          ) : null}

          <button
            type="button"
            role="tab"
            className="seg__btn"
            aria-selected={adminTab === "driver"}
            onClick={() => setAdminTab("driver")}
          >
            <><Image src="/bus.svg" alt="" aria-hidden width={18} height={18} className="svg-icon svg-icon--inline" />Session Chauffeur (Direct)</>
          </button>

          <button
            type="button"
            role="tab"
            className="seg__btn"
            aria-selected={adminTab === "circuits"}
            onClick={() => setAdminTab("circuits")}
          >
            <><Image src="/checklist.svg" alt="" aria-hidden width={18} height={18} className="svg-icon svg-icon--inline" />Circuits & Arrêts</>
          </button>
        </div>
      ) : null}

      {notice ? <div className={`alert alert--${notice.tone} transport-page__notice`}>{notice.text}</div> : null}

      {/* VUE 1 : CONSOLE CHAUFFEUR MOBILE-FIRST */}
      {(isChauffeur || adminTab === "driver") ? (
        <section className="transport-page__section" aria-labelledby="driver-console">
          <DriverLiveConsole />
        </section>
      ) : null}

      {/* VUE 2 : FLOTTE EN DIRECT (DIRECTION) */}
      {isDirection && adminTab === "fleet" ? (
        <section className="transport-page__section" aria-labelledby="fleet-monitor">
          <FleetLiveMap />
        </section>
      ) : null}

      {/* VUE 3 : GESTION DES CIRCUITS & ARRÊTS (EXISTANT ENRICHI) */}
      {adminTab === "circuits" ? (
        <>
          <section className="card stack transport-page__panel">
            <h2 className="h2">Circuits de l&apos;établissement</h2>
            <ul className="list-reset stack transport-page__circuit-list">
              {circuits.length === 0 ? <p className="muted">Aucun circuit enregistré.</p> : null}
              {circuits.map((c) => (
                <li key={c.id} className="row transport-page__circuit-row">
                  <span>
                    <strong>{c.name}</strong> · {c.stops.length} arrêt(s) · {c.studentCount} élève(s) · {c.attendant ?? "sans chauffeur/accompagnateur"}
                    {c.active ? null : <span className="badge transport-page__inactive">Inactif</span>}
                  </span>
                  <span className="row transport-page__row-actions">
                    <button className="btn" type="button" onClick={() => void open(c.id)}>Feuille de route</button>
                    {isDirection ? (
                      <button className="btn btn--ghost" type="button" disabled={busy} onClick={() => void run(async () => { await updateCircuit(c.id, { active: !c.active }); await load(); })}>
                        {c.active ? "Désactiver" : "Réactiver"}
                      </button>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
            {isDirection ? (
              <form className="row transport-page__form-row" onSubmit={onCreate}>
                <div className="field">
                  <label className="label" htmlFor="c-name">Nom du circuit</label>
                  <input id="c-name" className="input" value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={80} required />
                </div>
                <div className="field">
                  <label className="label" htmlFor="c-att">Chauffeur / Accompagnateur</label>
                  <select id="c-att" className="input" value={attendantId} onChange={(e) => setAttendantId(e.target.value)}>
                    <option value="">— aucun —</option>
                    {attendants.map((a) => (
                      <option key={a.id} value={a.id}>{a.displayName}</option>
                    ))}
                  </select>
                </div>
                <button className="btn btn--primary" type="submit" disabled={busy}>Créer le circuit</button>
              </form>
            ) : null}
          </section>

          {roadmap ? (
            <section className="card stack transport-page__panel" data-testid="roadmap">
              <h2 className="h2">
                {roadmap.circuit.name} · {formatCivilDate(roadmap.date)}
              </h2>
              {rows.map((group) =>
                group.students.length === 0 && group.key === "none" ? null : (
                  <div key={group.key} className="stack transport-page__roadmap-group">
                    <strong>{group.title}</strong>
                    {group.students.length === 0 ? <p className="muted">Aucun élève.</p> : null}
                    <ul className="list-reset stack transport-page__student-list">
                      {group.students.map((st) => (
                        <li key={st.id} className="row transport-page__student-row">
                          <span>
                            {st.displayName} · <span className="muted">{st.bus?.label ?? "Pas encore de statut"}</span>
                          </span>
                          <span className="row transport-page__row-actions">
                            {ONE_TAP.map((b) => (
                              <button key={b.status} className={`btn ${st.bus?.status === b.status ? "btn--primary" : ""}`} type="button" disabled={busy} onClick={() => tap(st.id, b.status)}>
                                {b.label}
                              </button>
                            ))}
                            {isDirection ? (
                              <button className="btn btn--ghost" type="button" disabled={busy} onClick={() => removeStudent(st.id)}>Retirer</button>
                            ) : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ),
              )}
              {isDirection ? (
                <>
                  <form className="row transport-page__form-row" onSubmit={onAddStop}>
                    <div className="field">
                      <label className="label" htmlFor="s-name">Nouvel arrêt</label>
                      <input id="s-name" className="input" value={stopName} onChange={(e) => setStopName(e.target.value)} minLength={2} maxLength={120} required />
                    </div>
                    <button className="btn" type="submit" disabled={busy}>Ajouter l&apos;arrêt</button>
                  </form>
                  <form
                    className="row transport-page__form-row"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void run(async () => setFound(await listStudents({ search: search.trim() })));
                    }}
                  >
                    <div className="field">
                      <label className="label" htmlFor="s-search">Ajouter un élève</label>
                      <input id="s-search" className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nom ou code" />
                    </div>
                    <button className="btn" type="submit" disabled={busy}>Rechercher</button>
                  </form>
                  <ul className="list-reset stack transport-page__student-list">
                    {found.slice(0, 20).map((s) => (
                      <li key={s.id} className="row transport-page__student-row">
                        <span>{s.displayName} · {s.classroom?.name ?? "sans classe"}</span>
                        <button className="btn" type="button" disabled={busy} onClick={() => addStudent(s.id)}>Ajouter</button>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </section>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
