"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { describeError, getConsentOverview, recordPaperConsent } from "@/lib/api";
import { formatCivilDate, formatDate, todayInMorocco } from "@/lib/labels";
import { useActiveProfile } from "@/lib/session";
import type {
  ConsentChannel,
  ConsentOverview,
  ConsentPurpose,
  ConsentRecordView,
  ConsentStudentRow,
  ConsentStudentStatus,
  ConsentTextRow,
} from "@/lib/types";

type Notice = { tone: "ok" | "error"; text: string } | null;

const PURPOSE_LABEL: Record<ConsentPurpose, string> = {
  student_account: "Compte élève",
  transport_alerts: "Alertes transport",
};

const STATUS_LABEL: Record<ConsentStudentStatus, string> = {
  accepted: "Accepté",
  withdrawn: "Retiré",
  pending: "En attente",
};

const STATUS_BADGE: Record<ConsentStudentStatus, string> = {
  accepted: "badge--active",
  withdrawn: "badge--absent",
  pending: "badge--pending",
};

const CHANNEL_LABEL: Record<ConsentChannel, string> = {
  web: "En ligne (web)",
  mobile: "En ligne (mobile)",
  paper_school: "Papier (école)",
};

const ACCOUNT_LABEL: Record<ConsentStudentRow["accountStatus"], string> = {
  none: "Compte élève non créé",
  active: "Compte élève actif",
  suspended_no_consent: "Compte élève suspendu (sans consentement)",
};

const LOCALE_LABEL: Record<string, string> = { fr: "Français", ar: "Arabe" };

function DraftBadge() {
  return (
    <span className="badge badge--legal-draft" data-testid="legal-draft">
      Brouillon juridique
    </span>
  );
}

function textLabel(text: ConsentTextRow | undefined): string {
  if (!text || text.version === null) return "Version non communiquée";
  return `${text.version} · ${LOCALE_LABEL[text.locale ?? ""] ?? text.locale}`;
}

/** t74u : suivi des consentements parentaux par la direction (lecture + canal papier). */
export default function ConsentsPage() {
  const profile = useActiveProfile();
  const allowed = profile?.role === "direction";

  const [data, setData] = useState<ConsentOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<Notice>(null);
  const [purpose, setPurpose] = useState<ConsentPurpose>("student_account");
  const [classroomId, setClassroomId] = useState("");
  const [status, setStatus] = useState<ConsentStudentStatus | "">("");
  const [textId, setTextId] = useState("");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await getConsentOverview());
    } catch (cause) {
      setNotice({ tone: "error", text: describeError(cause) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  const texts = useMemo(() => new Map((data?.texts ?? []).map((t) => [t.id, t])), [data]);
  const purposeTexts = useMemo(() => (data?.texts ?? []).filter((t) => t.purpose === purpose), [data, purpose]);

  const rows = useMemo(() => {
    if (!data) return [];
    const needle = search.trim().toLowerCase();
    return data.students.filter((student) => {
      const entry = student.purposes[purpose];
      if (classroomId && student.classroom?.id !== classroomId) return false;
      if (status && entry.status !== status) return false;
      if (textId) {
        const latest = student.records.find((r) => r.id === entry.latestId);
        if (!latest || latest.textId !== textId) return false;
      }
      if (needle && !student.displayName.toLowerCase().includes(needle) && !student.studentCode.toLowerCase().includes(needle)) {
        return false;
      }
      return true;
    });
  }, [data, purpose, classroomId, status, textId, search]);

  const selected = data?.students.find((s) => s.id === selectedId) ?? null;

  if (!allowed) {
    return (
      <main className="page">
        <div className="alert alert--error">Cette page est réservée à la direction.</div>
      </main>
    );
  }

  const counts = data?.purposes.find((p) => p.purpose === purpose);
  const currentForPurpose = (data?.current ?? []).filter((c) => c.purpose === purpose);

  return (
    <main className="page stack">
      <div className="page-head">
        <div>
          <h1 className="h1">Consentements</h1>
          <p className="subtitle">
            Consentements parentaux de votre établissement : textes, versions et statut par élève. Chaque enregistrement est tracé.
          </p>
        </div>
      </div>

      <div className="seg" role="group" aria-label="Finalité">
        {(Object.keys(PURPOSE_LABEL) as ConsentPurpose[]).map((value) => (
          <button
            key={value}
            type="button"
            className="seg__btn"
            aria-pressed={purpose === value}
            onClick={() => {
              setPurpose(value);
              setTextId("");
            }}
          >
            {PURPOSE_LABEL[value]}
          </button>
        ))}
      </div>

      {notice ? <div className={`alert alert--${notice.tone}`}>{notice.text}</div> : null}
      {loading && !data ? <p className="muted">Chargement…</p> : null}

      {data ? (
        <>
          <section className="card stack" data-testid="consent-texts">
            <h2 className="h2">Textes et versions · {PURPOSE_LABEL[purpose]}</h2>
            <div className="stats" data-testid="consent-counts">
              <span className="stat">
                <span className="dot dot--present" /> Acceptés : {counts?.accepted ?? 0}
              </span>
              <span className="stat">
                <span className="dot dot--absent" /> Retirés : {counts?.withdrawn ?? 0}
              </span>
              <span className="stat">
                <span className="dot dot--late" /> En attente : {counts?.pending ?? 0}
              </span>
              <span className="stat" title="ORYA n'enregistre pas de refus explicite : sans accord, l'élève reste en attente.">
                <span className="dot" /> Refusés : non enregistré
              </span>
            </div>
            <table className="table table--stack">
              <thead>
                <tr>
                  <th>Langue</th>
                  <th>Version</th>
                  <th>Statut du texte</th>
                  <th>Acceptés</th>
                  <th>Retirés</th>
                </tr>
              </thead>
              <tbody>
                {purposeTexts.map((text) => (
                  <tr key={text.id} data-testid="consent-text-row">
                    <td data-label="Langue">{text.locale ? (LOCALE_LABEL[text.locale] ?? text.locale) : "—"}</td>
                    <td data-label="Version" className="mono">
                      {text.version ?? "Non communiquée"}
                    </td>
                    <td data-label="Statut du texte">
                      {text.legalDraft ? <DraftBadge /> : <span className="badge badge--active">Validé</span>}
                      {text.retiredAt ? <span className="badge badge--muted">Retiré du service</span> : null}
                    </td>
                    <td data-label="Acceptés">{text.accepted}</td>
                    <td data-label="Retirés">{text.withdrawn}</td>
                  </tr>
                ))}
                {currentForPurpose
                  .filter((c) => c.legalDraft)
                  .map((c) => (
                    <tr key={`${c.purpose}-${c.locale}`} data-testid="consent-text-row">
                      <td data-label="Langue">{LOCALE_LABEL[c.locale]}</td>
                      <td data-label="Version" className="mono">
                        —
                      </td>
                      <td data-label="Statut du texte">
                        <DraftBadge />
                      </td>
                      <td data-label="Acceptés" colSpan={2} className="muted">
                        Aucune version validée par le juriste : aucun consentement ne peut être recueilli dans cette langue.
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
            <p className="hint">
              Un texte en brouillon juridique n&apos;est visible que de l&apos;équipe ORYA ; sa version n&apos;est pas communiquée
              à l&apos;école tant que le juriste ne l&apos;a pas validé.
            </p>
          </section>

          <form className="card filters" onSubmit={(event: FormEvent<HTMLFormElement>) => event.preventDefault()} data-testid="consent-filters">
            <div className="field">
              <label className="label" htmlFor="c-search">
                Élève (nom ou code)
              </label>
              <input id="c-search" className="input" value={search} onChange={(event) => setSearch(event.target.value)} />
            </div>
            <div className="field">
              <label className="label" htmlFor="c-class">
                Classe
              </label>
              <select id="c-class" className="select" value={classroomId} onChange={(event) => setClassroomId(event.target.value)}>
                <option value="">Toutes</option>
                {data.classrooms.map((classroom) => (
                  <option key={classroom.id} value={classroom.id}>
                    {classroom.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="label" htmlFor="c-status">
                Statut
              </label>
              <select
                id="c-status"
                className="select"
                value={status}
                onChange={(event) => setStatus(event.target.value as ConsentStudentStatus | "")}
              >
                <option value="">Tous</option>
                <option value="accepted">Accepté</option>
                <option value="withdrawn">Retiré</option>
                <option value="pending">En attente</option>
              </select>
            </div>
            <div className="field">
              <label className="label" htmlFor="c-text">
                Texte
              </label>
              <select id="c-text" className="select" value={textId} onChange={(event) => setTextId(event.target.value)}>
                <option value="">Tous les textes</option>
                {purposeTexts.map((text) => (
                  <option key={text.id} value={text.id}>
                    {text.legalDraft ? `Brouillon juridique${text.version ? ` · ${text.version}` : ""}` : textLabel(text)}
                  </option>
                ))}
              </select>
            </div>
          </form>

          {/* t74u-b : liste en pleine largeur, panneau Détail en dessous (aucune colonne coupée). */}
          <div className="stack">
            <section className="card" data-testid="consent-students">
              <p className="muted">
                {rows.length} élève(s) sur {data.students.length} · année {data.schoolYear}
                {data.truncated ? " · liste tronquée aux 2 000 premiers élèves" : ""}
              </p>
              {rows.length === 0 ? (
                <p className="muted">Aucun élève ne correspond à ces filtres.</p>
              ) : (
                <div className="table-scroll">
                <table className="table table--stack">
                  <thead>
                    <tr>
                      <th>Élève</th>
                      <th>Classe</th>
                      <th>Statut</th>
                      <th>Date</th>
                      <th>Canal</th>
                      <th>Responsable</th>
                      <th>Texte</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((student) => {
                      const entry = student.purposes[purpose];
                      const latest = student.records.find((r) => r.id === entry.latestId) ?? null;
                      const text = latest ? texts.get(latest.textId) : undefined;
                      return (
                        <tr key={student.id} data-testid="consent-student-row" aria-selected={student.id === selectedId}>
                          <td data-label="Élève">
                            <button type="button" className="btn btn--ghost" onClick={() => setSelectedId(student.id)}>
                              {student.displayName}
                            </button>{" "}
                            <span className="mono muted">{student.studentCode}</span>
                          </td>
                          <td data-label="Classe">{student.classroom?.name ?? <span className="badge badge--pending">Sans classe</span>}</td>
                          <td data-label="Statut">
                            <span className={`badge ${STATUS_BADGE[entry.status]}`}>{STATUS_LABEL[entry.status]}</span>
                          </td>
                          <td data-label="Date">
                            {latest ? formatDate(latest.revokedAt ?? latest.grantedAt) : "—"}
                          </td>
                          <td data-label="Canal">{latest ? CHANNEL_LABEL[latest.channel] : "—"}</td>
                          <td data-label="Responsable">{latest?.guardian ?? "—"}</td>
                          <td data-label="Texte">
                            {latest ? (text && !text.legalDraft ? textLabel(text) : <DraftBadge />) : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                </div>
              )}
            </section>

            <ConsentDetail
              key={selected?.id ?? "none"}
              student={selected}
              purpose={purpose}
              texts={texts}
              current={currentForPurpose}
              onRecorded={async (message) => {
                setNotice({ tone: "ok", text: message });
                await load();
              }}
              onError={(message) => setNotice({ tone: "error", text: message })}
            />
          </div>
        </>
      ) : null}
    </main>
  );
}

function ConsentDetail({
  student,
  purpose,
  texts,
  current,
  onRecorded,
  onError,
}: {
  student: ConsentStudentRow | null;
  purpose: ConsentPurpose;
  texts: Map<string, ConsentTextRow>;
  current: ConsentOverview["current"];
  onRecorded: (message: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  const validated = current.filter((c) => !c.legalDraft && c.textId);
  const [textId, setTextId] = useState(validated[0]?.textId ?? "");
  const [guardianName, setGuardianName] = useState("");
  const [paperDate, setPaperDate] = useState(todayInMorocco());
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);

  if (!student) {
    return (
      <aside className="card stack" data-testid="consent-detail">
        <h2 className="h2">Détail</h2>
        <p className="muted">Choisissez un élève pour voir l&apos;historique de ses consentements.</p>
      </aside>
    );
  }

  const records = student.records.filter((r) => r.purpose === purpose);
  const entry = student.purposes[purpose];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!student || !textId) return;
    setBusy(true);
    try {
      await recordPaperConsent(student.id, {
        textId,
        purpose,
        guardianName: guardianName.trim(),
        paperDate,
        paperFileReference: reference.trim(),
      });
      setGuardianName("");
      setReference("");
      await onRecorded("Consentement papier enregistré (tracé dans le journal d'audit).");
    } catch (cause) {
      onError(describeError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="card stack" data-testid="consent-detail">
      <div>
        <h2 className="h2">{student.displayName}</h2>
        <p className="muted">
          <span className="mono">{student.studentCode}</span> · {student.classroom?.name ?? "Sans classe"} · {ACCOUNT_LABEL[student.accountStatus]}
        </p>
        <p>
          {PURPOSE_LABEL[purpose]} : <span className={`badge ${STATUS_BADGE[entry.status]}`}>{STATUS_LABEL[entry.status]}</span>
        </p>
      </div>

      <h3 className="label">Historique</h3>
      {records.length === 0 ? (
        <p className="muted">Aucun consentement enregistré pour cette finalité.</p>
      ) : (
        <ul className="timeline list-reset">
          {records.map((record: ConsentRecordView) => {
            const text = texts.get(record.textId);
            return (
              <li key={record.id} className="timeline__item">
                <div>
                  <strong>{record.revokedAt ? "Retiré" : "Accepté"}</strong> · {CHANNEL_LABEL[record.channel]}
                </div>
                <div className="muted">
                  Accordé le {formatDate(record.grantedAt)}
                  {record.revokedAt ? ` · retiré le ${formatDate(record.revokedAt)}` : ""}
                </div>
                <div>Responsable : {record.guardian ?? "—"}</div>
                <div>Texte : {text && !text.legalDraft ? textLabel(text) : <DraftBadge />}</div>
                {record.channel === "paper_school" ? (
                  <div className="muted">
                    Formulaire du {record.paperDate ? formatCivilDate(record.paperDate) : "—"} · référence{" "}
                    <span className="mono">{record.paperFileReference ?? "—"}</span>
                    {record.hasScan ? " · scan joint" : " · sans scan"}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <h3 className="label">Enregistrer un consentement papier</h3>
      {validated.length === 0 ? (
        <div className="alert alert--warn" data-testid="paper-blocked">
          Impossible pour l&apos;instant : le texte « {PURPOSE_LABEL[purpose]} » est en <strong>brouillon juridique</strong>.
          Un consentement ne peut être enregistré que sur un texte validé par le juriste.
        </div>
      ) : (
        <form className="stack" onSubmit={(event) => void submit(event)} data-testid="paper-form">
          <div className="field">
            <label className="label" htmlFor="p-text">
              Texte signé
            </label>
            <select id="p-text" className="select" value={textId} onChange={(event) => setTextId(event.target.value)}>
              {validated.map((c) => (
                <option key={c.textId} value={c.textId ?? ""}>
                  {c.version} · {LOCALE_LABEL[c.locale]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="label" htmlFor="p-guardian">
              Responsable signataire
            </label>
            <input
              id="p-guardian"
              className="input"
              value={guardianName}
              minLength={2}
              maxLength={120}
              required
              onChange={(event) => setGuardianName(event.target.value)}
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="p-date">
              Date du formulaire
            </label>
            <input id="p-date" className="input" type="date" value={paperDate} max={todayInMorocco()} required onChange={(event) => setPaperDate(event.target.value)} />
          </div>
          <div className="field">
            <label className="label" htmlFor="p-ref">
              Référence du dossier papier
            </label>
            <input
              id="p-ref"
              className="input"
              value={reference}
              minLength={2}
              maxLength={200}
              required
              onChange={(event) => setReference(event.target.value)}
            />
          </div>
          <p className="hint">
            Le formulaire signé reste au dossier de l&apos;école. Le scan n&apos;est pas encore joignable depuis cet écran.
          </p>
          <button className="btn btn--teal" type="submit" disabled={busy || !textId}>
            Enregistrer le consentement papier
          </button>
        </form>
      )}
    </aside>
  );
}
