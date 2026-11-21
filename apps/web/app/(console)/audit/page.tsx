"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, listAudit } from "@/lib/api";
import { formatDate } from "@/lib/labels";
import { useActiveProfile } from "@/lib/session";
import type { AuditRow } from "@/lib/types";

export default function AuditPage() {
  const profile = useActiveProfile();
  const allowed = profile?.role === "direction" || profile?.role === "super_admin";

  const [entries, setEntries] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setEntries(await listAudit(100));
      setError(null);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (allowed) {
      void load();
    }
  }, [allowed, load]);

  if (!allowed) {
    return (
      <main className="page">
        <div className="alert alert--warn" role="status">
          Le journal d&apos;audit est réservé à la direction et au super-admin.
        </div>
      </main>
    );
  }

  return (
    <main className="page stack">
      <div>
        <h1 className="h1">Journal d&apos;audit</h1>
        <p className="subtitle">
          Connexions, activations, validations d&apos;école. Les entrées sont inaltérables côté base.
        </p>
      </div>

      {error ? (
        <p className="alert alert--error" role="alert">
          {error}
        </p>
      ) : null}

      <section className="card">
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
          <h2 className="h2">{entries.length} événements récents</h2>
          <button className="btn" type="button" onClick={() => void load()} disabled={loading}>
            {loading ? "Chargement…" : "Actualiser"}
          </button>
        </div>

        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Action</th>
              <th>Entité</th>
              <th>Gravité</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td className="muted">{formatDate(entry.createdAt)}</td>
                <td className="mono">{entry.action}</td>
                <td>
                  {entry.entity}
                  {entry.entityId ? <span className="muted"> · {entry.entityId.slice(0, 8)}…</span> : null}
                </td>
                <td>
                  <span
                    className={
                      entry.severity === "critical"
                        ? "badge badge--pending"
                        : entry.severity === "warning"
                          ? "badge"
                          : "badge badge--muted"
                    }
                  >
                    {entry.severity}
                  </span>
                </td>
              </tr>
            ))}
            {entries.length === 0 && !loading ? (
              <tr>
                <td colSpan={4} className="muted">
                  Aucun événement.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </main>
  );
}
