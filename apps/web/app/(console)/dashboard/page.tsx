"use client";

import Link from "next/link";
import { formatDate, roleLabel, schoolStatusLabel } from "@/lib/labels";
import { selectProfile } from "@/lib/api";
import { useActiveProfile, useSession } from "@/lib/session";
import { DirectionDashboard } from "@/lib/direction-dashboard";
import { TeacherDashboard } from "@/components/TeacherDashboard";

export default function DashboardPage() {
  const { me, reload } = useSession();
  const profile = useActiveProfile();

  if (!me || !profile) {
    return null;
  }

  const schoolPending =
    profile.role !== "super_admin" &&
    profile.schoolStatus !== null &&
    profile.schoolStatus !== "active";

  return (
    <main className="page stack">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 className="h1" style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.02em" }}>Tableau de bord</h1>
          <p className="subtitle" style={{ fontSize: 14 }}>
            {profile.schoolName ?? "Console ORYA"} · <span className="badge badge--purple">{roleLabel(profile.role)}</span>
          </p>
        </div>
      </div>

      {schoolPending ? (
        <div className="alert alert--warn" role="status">
          Cet établissement est <strong>{schoolStatusLabel(profile.schoolStatus)}</strong>. L&apos;accès
          aux données sera ouvert après validation par ORYA.
        </div>
      ) : null}

      {profile.role === "direction" && !schoolPending ? <DirectionDashboard /> : null}
      {profile.role === "teacher" && !schoolPending ? <TeacherDashboard /> : null}

      <section className="grid">
        <article className="card" style={{ borderTop: "3px solid var(--purple)" }}>
          <p className="muted" style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 700 }}>Établissement</p>
          <p className="h2" style={{ marginTop: 6, fontWeight: 800 }}>
            {profile.schoolName ?? "ORYA"}
          </p>
          <p style={{ marginTop: 8 }}>
            <span className={`badge ${profile.schoolStatus === "active" ? "badge--active" : "badge--pending"}`}>
              {schoolStatusLabel(profile.schoolStatus)}
            </span>
          </p>
        </article>

        <article className="card" style={{ borderTop: "3px solid var(--marine)" }}>
          <p className="muted" style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 700 }}>Sécurité du compte</p>
          <p className="h2" style={{ marginTop: 6, fontWeight: 800 }}>
            {me.user.mfaEnabled ? "2FA activé" : "2FA inactif"}
          </p>
          <p style={{ marginTop: 8 }}>
            <span className={`badge ${me.user.mfaEnabled ? "badge--active" : "badge--pending"}`}>
              {me.user.mfaEnabled ? "Protégé" : "À configurer"}
            </span>
          </p>
        </article>

        <article className="card" style={{ borderTop: "3px solid #5022c3" }}>
          <p className="muted" style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 700 }}>Compte utilisateur</p>
          <p className="h2" style={{ marginTop: 6, fontWeight: 800, wordBreak: "break-all", fontSize: 18 }}>
            {me.user.email}
          </p>
          <p className="muted" style={{ marginTop: 6, fontSize: 13 }}>
            Inscrit le {formatDate(me.user.createdAt)}
          </p>
        </article>
      </section>

      <section className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h2 className="h2" style={{ fontWeight: 800 }}>Vos profils & rôles d&apos;accès</h2>
            <p className="muted" style={{ marginTop: 2, fontSize: 13 }}>Basculez entre vos différents espaces d&apos;enseignement ou d&apos;administration</p>
          </div>
        </div>
        <ul className="list-reset stack" style={{ gap: 10, marginTop: 16 }}>
          {me.profiles.map((item) => (
            <li
              key={item.id}
              className="row"
              style={{
                justifyContent: "space-between",
                padding: "12px 16px",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--line)",
                background: item.id === me.activeProfileId ? "var(--purple-soft)" : "var(--surface)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: "50%",
                    background: item.id === me.activeProfileId ? "var(--purple-deep)" : "var(--marine)",
                    color: "#fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: 700,
                    fontSize: 14,
                  }}
                >
                  {roleLabel(item.role).charAt(0).toUpperCase()}
                </div>
                <div>
                  <div style={{ fontWeight: 700, color: "var(--marine)" }}>{roleLabel(item.role)}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>{item.schoolName ?? "ORYA"}</div>
                </div>
              </div>
              <span className="row" style={{ gap: 8 }}>
                <span className="badge badge--muted">{schoolStatusLabel(item.schoolStatus)}</span>
                {item.id === me.activeProfileId ? (
                  <span className="badge badge--active">Actif</span>
                ) : (
                  <button
                    className="btn btn--outline"
                    style={{ minHeight: 36, padding: "0 12px", fontSize: 13 }}
                    type="button"
                    onClick={() => {
                      void selectProfile(item.id).then(() => reload());
                    }}
                  >
                    Sélectionner
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="card card--flat">
        <h2 className="h2">Prochaines étapes</h2>
        <p className="muted" style={{ marginTop: 8 }}>
          Raccourcis vers les écrans d&apos;administration, branchés sur l&apos;API réelle.
        </p>
        <div className="row" style={{ marginTop: 16 }}>
          {profile.role === "super_admin" ? (
            <Link className="btn btn--primary" href="/schools">
              Gérer les établissements
            </Link>
          ) : null}
          {profile.role === "direction" || profile.role === "super_admin" ? (
            <Link className="btn" href="/audit">
              Consulter le journal d&apos;audit
            </Link>
          ) : null}
        </div>
      </section>
    </main>
  );
}
