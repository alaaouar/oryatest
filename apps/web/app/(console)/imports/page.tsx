"use client";

import { useEffect, useState, type FormEvent } from "react";
import { cancelImport, commitImport, describeError, listClassrooms, startImport } from "@/lib/api";
import { useActiveProfile } from "@/lib/session";
import type { ImportKind, ImportPreview } from "@/lib/types";

const MAX_BYTES = 5 * 1024 * 1024;

const HELP: Record<ImportKind, string> = {
  students: "Colonnes attendues : classe, code élève, nom (code Massar, date de naissance facultatifs).",
  guardians:
    "Colonnes attendues : code élève, nom du responsable (e-mail, téléphone, lien, adresse, principal facultatifs). Un élève accepte au plus deux responsables.",
};

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(new Error("Lecture du fichier impossible."));
    reader.readAsDataURL(file);
  });
}

/** Lot 2.1 / 2.1b : import CSV/XLSX des élèves ou des responsables (direction). */
export default function ImportsPage() {
  const profile = useActiveProfile();
  const allowed = profile?.role === "direction";

  const [kind, setKind] = useState<ImportKind>("students");
  const [schoolYear, setSchoolYear] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!allowed) return;
    listClassrooms()
      .then((data) => setSchoolYear((current) => current || data.schoolYear))
      .catch(() => undefined);
  }, [allowed]);

  async function onUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setError("Fichier trop volumineux (5 Mo maximum).");
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const contentBase64 = await toBase64(file);
      setPreview(await startImport({ filename: file.name, contentBase64, schoolYear, kind }));
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function onCommit() {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await commitImport(preview.id));
      setPreview(null);
      setFile(null);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function onCancel() {
    if (!preview) return;
    setBusy(true);
    try {
      await cancelImport(preview.id);
      setPreview(null);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  }

  if (!allowed) {
    return (
      <main className="page">
        <div className="alert alert--error">Cette page est réservée à la direction.</div>
      </main>
    );
  }

  const columns = preview && preview.preview.length > 0 ? Object.keys(preview.preview[0]) : [];

  return (
    <main className="page stack">
      <div className="page-head">
        <div>
          <h1 className="h1">Imports</h1>
          <p className="subtitle">Aperçu et contrôle ligne par ligne avant toute écriture.</p>
        </div>
      </div>

      <form className="card stack" onSubmit={(event) => void onUpload(event)}>
        <div className="seg" role="group" aria-label="Type d'import">
          {(["students", "guardians"] as const).map((value) => (
            <button
              key={value}
              type="button"
              className="seg__btn"
              aria-pressed={kind === value}
              onClick={() => {
                setKind(value);
                setPreview(null);
                setResult(null);
              }}
            >
              {value === "students" ? "Élèves et classes" : "Responsables"}
            </button>
          ))}
        </div>
        <p className="hint">{HELP[kind]}</p>
        <div className="field">
          <label className="label" htmlFor="year">
            Année scolaire
          </label>
          <input id="year" className="input" value={schoolYear} onChange={(e) => setSchoolYear(e.target.value)} pattern="\d{4}-\d{4}" required />
        </div>
        <div className="field">
          <label className="label" htmlFor="file">
            Fichier CSV ou XLSX
          </label>
          <input
            id="file"
            type="file"
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>
        <button className="btn btn--primary" type="submit" disabled={busy || !file}>
          Analyser le fichier
        </button>
      </form>

      {error ? <div className="alert alert--error">{error}</div> : null}

      {result ? (
        <div className="alert alert--ok">
          Import validé.{" "}
          {result.kind === "guardians"
            ? `${String(result.guardiansCreated)} responsable(s) créé(s), ${String(result.guardiansReused)} réutilisé(s), ${String(result.links)} lien(s) enfant, ${Array.isArray(result.skipped) ? result.skipped.length : 0} ligne(s) ignorée(s).`
            : `${String(result.students ?? "")} élève(s), ${String(result.classrooms ?? "")} classe(s), ${String(result.enrollments ?? "")} inscription(s).`}
        </div>
      ) : null}

      {preview ? (
        <section className="card stack">
          <h2 className="h2">Aperçu</h2>
          <p>
            {preview.totalRows} ligne(s) · <strong>{preview.validRows} valide(s)</strong> · {preview.invalidRows} erreur(s)
          </p>
          {preview.errors.length > 0 ? (
            <div className="alert alert--warn">
              <ul className="list-reset">
                {preview.errors.map((entry, index) => (
                  <li key={`${entry.line}-${index}`}>
                    Ligne {entry.line}
                    {entry.column ? ` (${entry.column})` : ""} : {entry.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {columns.length > 0 ? (
            <table className="table">
              <thead>
                <tr>
                  {columns.map((column) => (
                    <th key={column}>{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.preview.map((row, index) => (
                  <tr key={index}>
                    {columns.map((column) => (
                      <td key={column}>{row[column] === undefined || row[column] === null ? "" : String(row[column])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          <div className="row">
            <button className="btn btn--primary" type="button" disabled={busy || preview.validRows === 0} onClick={() => void onCommit()}>
              Importer {preview.validRows} ligne(s) valide(s)
            </button>
            <button className="btn btn--ghost" type="button" disabled={busy} onClick={() => void onCancel()}>
              Annuler
            </button>
          </div>
        </section>
      ) : null}
    </main>
  );
}
