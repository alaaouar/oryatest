"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  cancelMyDeletion,
  changeMyPassword,
  createDataRights,
  getMyDeletion,
  requestMyDeletion,
  type MyDeletionRequest,
  dataExportLink,
  describeError,
  listDataExports,
  listMyDataRights,
  requestDataExport,
  type DataExportView,
  type DataRightsView,
} from "@/lib/api";
import { codeLabel, LocaleSwitch, useI18n } from "@/lib/i18n";

type Notice = { tone: "ok" | "error"; text: string } | null;

/** Bloc 4 : droit d'acces (export JSON + PDF, 7 jours), rectification et opposition (t52u C7 : FR/AR, arabe a relire). */
export default function MyDataPage() {
  const { locale, setLocale, t, dir } = useI18n();
  const [exportsList, setExports] = useState<DataExportView[]>([]);
  const [rights, setRights] = useState<DataRightsView[]>([]);
  const [notice, setNotice] = useState<Notice>(null);
  const [kind, setKind] = useState<"rectification" | "opposition">("rectification");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [deletion, setDeletion] = useState<MyDeletionRequest | null>(null);
  const [delPassword, setDelPassword] = useState("");
  const [delMfa, setDelMfa] = useState("");
  const [deletionRequested, setDeletionRequested] = useState(false);
  const [pwCurrent, setPwCurrent] = useState("");
  const [pwNew, setPwNew] = useState("");
  const [pwConfirm, setPwConfirm] = useState("");

  const load = useCallback(async () => {
    try {
      const [e, r, del] = await Promise.all([listDataExports(), listMyDataRights(), getMyDeletion()]);
      setExports(e.items);
      setRights(r.items);
      setDeletion(del.request);
    } catch (error) {
      setNotice({ tone: "error", text: describeError(error) });
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function onExport() {
    try {
      await requestDataExport();
      setNotice({ tone: "ok", text: t("md_export_sent") });
      await load();
    } catch (error) {
      setNotice({ tone: "error", text: describeError(error) });
    }
  }

  async function onDownload(id: string, format: "json" | "pdf") {
    try {
      const link = await dataExportLink(id, format);
      if (link.url) window.location.assign(link.url);
    } catch (error) {
      setNotice({ tone: "error", text: describeError(error) });
    }
  }

  async function onDeletion(event: FormEvent) {
    event.preventDefault();
    try {
      await requestMyDeletion(delPassword, delMfa || undefined);
      // L'API desactive le compte et revoque toutes les sessions des la demande :
      // on informe puis on renvoie vers la connexion (annulation : aupres de l'etablissement / support).
      setDeletionRequested(true);
      setNotice({ tone: "ok", text: t("md_deletion_sent") });
      window.setTimeout(() => window.location.assign("/login"), 2500);
    } catch (error) {
      setNotice({ tone: "error", text: describeError(error) });
    } finally {
      setDelPassword("");
      setDelMfa("");
    }
  }

  async function onPassword(event: FormEvent) {
    event.preventDefault();
    if (pwNew !== pwConfirm) {
      setNotice({ tone: "error", text: t("md_pw_mismatch") });
      return;
    }
    try {
      const result = await changeMyPassword(pwCurrent, pwNew);
      setNotice({ tone: "ok", text: `${t("md_pw_done")} ${result.revokedSessions}.` });
    } catch (error) {
      setNotice({ tone: "error", text: describeError(error) });
    } finally {
      setPwCurrent("");
      setPwNew("");
      setPwConfirm("");
    }
  }

  async function onCancelDeletion() {
    try {
      await cancelMyDeletion();
      setNotice({ tone: "ok", text: t("md_deletion_cancelled") });
      await load();
    } catch (error) {
      setNotice({ tone: "error", text: describeError(error) });
    }
  }

  async function onRights(event: FormEvent) {
    event.preventDefault();
    try {
      await createDataRights({ kind, subject, message });
      setSubject("");
      setMessage("");
      setNotice({ tone: "ok", text: t("md_rights_sent") });
      await load();
    } catch (error) {
      setNotice({ tone: "error", text: describeError(error) });
    }
  }

  return (
    <main className="page stack" dir={dir} lang={locale}>
      <div className="page-head">
        <div>
          <h1 className="h1">{t("md_title")}</h1>
          <p className="subtitle">{t("md_subtitle")}</p>
        </div>
        {/* <LocaleSwitch locale={locale} setLocale={setLocale} label={t("lang_switch")} /> */}
      </div>
      {notice ? <div className={`alert alert--${notice.tone}`}>{notice.text}</div> : null}

      <section className="card stack">
        <h2 className="h2">{t("md_export_title")}</h2>
        <p className="muted">{t("md_export_help")}</p>
        <button className="btn btn--primary" type="button" onClick={() => void onExport()}>
          {t("md_export_button")}
        </button>
        <ul className="list-reset parent-list">
          {exportsList.map((e) => (
            <li key={e.id} className="parent-list__item">
              <span>
                {e.requestedAt.slice(0, 10)} - {codeLabel(locale, e.status)}
                {e.expiresAt ? ` (${t("md_until")} ${e.expiresAt.slice(0, 10)})` : ""}
              </span>
              {e.status === "ready" ? (
                <span>
                  <button className="btn btn--ghost" type="button" onClick={() => void onDownload(e.id, "json")}>
                    JSON
                  </button>
                  <button className="btn btn--ghost" type="button" onClick={() => void onDownload(e.id, "pdf")}>
                    PDF
                  </button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <form className="card stack" onSubmit={(event) => void onRights(event)}>
        <h2 className="h2">{t("md_rights_title")}</h2>
        <div className="field">
          <label className="label" htmlFor="r-kind">
            {t("md_kind")}
          </label>
          <select id="r-kind" className="select" value={kind} onChange={(e) => setKind(e.target.value as "rectification" | "opposition")}>
            <option value="rectification">{t("md_rectification")}</option>
            <option value="opposition">{t("md_opposition")}</option>
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor="r-subject">
            {t("md_subject")}
          </label>
          <input id="r-subject" className="input" value={subject} onChange={(e) => setSubject(e.target.value)} minLength={3} maxLength={200} required />
        </div>
        <div className="field">
          <label className="label" htmlFor="r-message">
            {t("md_message")}
          </label>
          <textarea id="r-message" className="textarea" value={message} onChange={(e) => setMessage(e.target.value)} minLength={3} maxLength={4000} required />
        </div>
        <button className="btn btn--primary" type="submit">
          {t("md_send")}
        </button>
        <ul className="list-reset parent-list">
          {rights.map((r) => (
            <li key={r.id} className="parent-list__item">
              <span>
                {codeLabel(locale, r.kind)} - {r.subject}
                {r.response ? ` - ${t("md_response")} ${r.response}` : ""}
              </span>
              <span className="badge">{codeLabel(locale, r.status)}</span>
            </li>
          ))}
        </ul>
      </form>

      <form className="card stack" data-testid="password-change" onSubmit={(event) => void onPassword(event)}>
        <h2 className="h2">{t("md_pw_title")}</h2>
        <p className="muted">{t("md_pw_help")}</p>
        <div className="field">
          <label className="label" htmlFor="pw-current">
            {t("md_pw_current")}
          </label>
          <input id="pw-current" className="input" type="password" autoComplete="current-password" value={pwCurrent} onChange={(e) => setPwCurrent(e.target.value)} minLength={8} maxLength={128} required />
        </div>
        <div className="field">
          <label className="label" htmlFor="pw-new">
            {t("md_pw_new")}
          </label>
          <input id="pw-new" className="input" type="password" autoComplete="new-password" value={pwNew} onChange={(e) => setPwNew(e.target.value)} minLength={12} maxLength={128} required />
        </div>
        <div className="field">
          <label className="label" htmlFor="pw-confirm">
            {t("md_pw_confirm")}
          </label>
          <input id="pw-confirm" className="input" type="password" autoComplete="new-password" value={pwConfirm} onChange={(e) => setPwConfirm(e.target.value)} minLength={12} maxLength={128} required />
        </div>
        <button className="btn btn--primary" type="submit">
          {t("md_pw_button")}
        </button>
      </form>

      <section className="card stack" data-testid="account-deletion">
        <h2 className="h2">{t("md_delete_title")}</h2>
        <p className="muted">{t("md_delete_help")}</p>
        {deletionRequested ? (
          <p data-testid="deletion-requested">{t("md_delete_requested")}</p>
        ) : deletion?.status === "pending" ? (
          <div className="stack">
            <p data-testid="deletion-pending">
              {t("md_delete_scheduled")}{deletion.effectiveAt ? ` ${t("md_on")} ${deletion.effectiveAt.slice(0, 10)}` : ""}.
            </p>
            <button className="btn btn--ghost" type="button" onClick={() => void onCancelDeletion()}>
              {t("md_cancel_delete")}
            </button>
          </div>
        ) : (
          <form className="stack" onSubmit={(event) => void onDeletion(event)}>
            <div className="field">
              <label className="label" htmlFor="del-password">
                {t("md_password")}
              </label>
              <input
                id="del-password"
                className="input"
                type="password"
                autoComplete="current-password"
                value={delPassword}
                onChange={(e) => setDelPassword(e.target.value)}
                minLength={8}
                required
              />
            </div>
            <div className="field">
              <label className="label" htmlFor="del-mfa">
                {t("md_mfa")}
              </label>
              <input
                id="del-mfa"
                className="input"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={delMfa}
                onChange={(e) => setDelMfa(e.target.value.replace(/\D/g, "").slice(0, 8))}
              />
            </div>
            <button className="btn btn--primary" type="submit">
              {t("md_delete_button")}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}