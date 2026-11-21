"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ApiError,
  createSchool,
  createSchoolAdmin,
  listSchools,
  validateSchool,
} from "@/lib/api";
import { formatDate, schoolStatusLabel, subscriptionStatusLabel } from "@/lib/labels";
import { useActiveProfile } from "@/lib/session";
import type { SchoolAdminInfo, SchoolRow } from "@/lib/types";

function generateSecurePassword(): string {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let pwd = "";
  for (let i = 0; i < 8; i++) {
    pwd += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pwd + "!Orya26";
}

type CreatedCredentials = {
  schoolName: string;
  schoolCode: string;
  adminEmail: string;
  adminName: string;
  password?: string;
};

export default function SchoolsPage() {
  const profile = useActiveProfile();
  const isSuperAdmin = profile?.role === "super_admin";

  const [schools, setSchools] = useState<SchoolRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Filtre de recherche
  const [search, setSearch] = useState("");

  // Formulaire création école
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [ice, setIce] = useState("");
  const [autoActivate, setAutoActivate] = useState(true);

  // Formulaire création admin école (optionnel à la création)
  const [withAdmin, setWithAdmin] = useState(true);
  const [adminEmail, setAdminEmail] = useState("");
  const [adminName, setAdminName] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Modal / Carte des identifiants créés
  const [credentialsNotice, setCredentialsNotice] = useState<CreatedCredentials | null>(null);
  const [copied, setCopied] = useState(false);

  // Modal ajout d'un admin à une école existante
  const [selectedSchoolForAdmin, setSelectedSchoolForAdmin] = useState<SchoolRow | null>(null);
  const [modalAdminEmail, setModalAdminEmail] = useState("");
  const [modalAdminName, setModalAdminName] = useState("");
  const [modalAdminPassword, setModalAdminPassword] = useState("");
  const [modalBusy, setModalBusy] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSchools(await listSchools());
      setError(null);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isSuperAdmin) {
      void load();
    }
  }, [isSuperAdmin, load]);

  // Initialisation mot de passe par défaut
  useEffect(() => {
    if (!adminPassword) {
      setAdminPassword(generateSecurePassword());
    }
  }, [adminPassword]);

  // Statistiques rapides
  const stats = useMemo(() => {
    const total = schools.length;
    const active = schools.filter((s) => s.status === "active").length;
    const pending = schools.filter((s) => s.status === "pending").length;
    let totalAdmins = 0;
    for (const s of schools) {
      totalAdmins += s.profiles?.length ?? 0;
    }
    return { total, active, pending, totalAdmins };
  }, [schools]);

  // Écoles filtrées
  const filteredSchools = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return schools;
    return schools.filter((s) => {
      if (s.name.toLowerCase().includes(query)) return true;
      if (s.city.toLowerCase().includes(query)) return true;
      if (s.code.toLowerCase().includes(query)) return true;
      if (s.ice && s.ice.toLowerCase().includes(query)) return true;
      if (s.profiles?.some((p) => p.user.email.toLowerCase().includes(query) || p.displayName.toLowerCase().includes(query))) {
        return true;
      }
      return false;
    });
  }, [schools, search]);

  if (!isSuperAdmin) {
    return (
      <main className="page">
        <div className="alert alert--warn" role="status">
          Cette console est réservée au super-administrateur ORYA.
        </div>
      </main>
    );
  }

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);

    const emailToUse = withAdmin ? adminEmail.trim().toLowerCase() : undefined;
    const nameToUse = withAdmin ? (adminName.trim() || `Direction ${name.trim()}`) : undefined;
    const pwdToUse = withAdmin ? (adminPassword.trim() || generateSecurePassword()) : undefined;

    try {
      const created = await createSchool({
        name: name.trim(),
        city: city.trim(),
        ice: ice.trim() === "" ? undefined : ice.trim(),
        status: autoActivate ? "active" : "pending",
        adminEmail: emailToUse,
        adminName: nameToUse,
        adminPassword: pwdToUse,
      });

      if (created.admin) {
        setCredentialsNotice({
          schoolName: created.name,
          schoolCode: created.code,
          adminEmail: created.admin.email,
          adminName: created.admin.displayName,
          password: created.admin.initialPassword ?? pwdToUse,
        });
      }

      setNotice(
        `Établissement « ${created.name} » créé avec succès ! Code familles : ${created.code}${
          created.admin ? ` · Compte administrateur créé pour ${created.admin.email}` : ""
        }`,
      );

      // Réinitialisation du formulaire
      setName("");
      setCity("");
      setIce("");
      setAdminEmail("");
      setAdminName("");
      setAdminPassword(generateSecurePassword());
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Création impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function onValidate(school: SchoolRow) {
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      await validateSchool(school.id);
      setNotice(`« ${school.name} » est désormais actif : les comptes peuvent se connecter.`);
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Validation impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function onAddSchoolAdmin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedSchoolForAdmin) return;

    setModalBusy(true);
    setModalError(null);

    const email = modalAdminEmail.trim().toLowerCase();
    const displayName = modalAdminName.trim() || `Direction ${selectedSchoolForAdmin.name}`;
    const password = modalAdminPassword.trim() || generateSecurePassword();

    try {
      const result = await createSchoolAdmin(selectedSchoolForAdmin.id, {
        email,
        displayName,
        password,
      });

      setCredentialsNotice({
        schoolName: selectedSchoolForAdmin.name,
        schoolCode: selectedSchoolForAdmin.code,
        adminEmail: result.email,
        adminName: result.displayName,
        password: result.initialPassword ?? password,
      });

      setNotice(`Administrateur ${result.email} rattaché avec succès à « ${selectedSchoolForAdmin.name} » !`);
      setSelectedSchoolForAdmin(null);
      setModalAdminEmail("");
      setModalAdminName("");
      setModalAdminPassword("");
      await load();
    } catch (cause) {
      setModalError(cause instanceof ApiError ? cause.message : "Création de l'administrateur impossible.");
    } finally {
      setModalBusy(false);
    }
  }

  function copyCredentials(c: CreatedCredentials) {
    const text = `=== IDENTIFIANTS D'ACCÈS ORYA ===\nÉtablissement : ${c.schoolName}\nCode familles : ${c.schoolCode}\nAdresse e-mail : ${c.adminEmail}\nNom : ${c.adminName}\nMot de passe : ${c.password ?? "(inchangé)"}\nLien de connexion : ${window.location.origin}/login\n=================================`;
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  }

  return (
    <main className="page stack">
      {/* En-tête de session Super-Admin */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="badge badge--purple" style={{ textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 800 }}>
              Session Super-Admin ORYA
            </span>
          </div>
          <h1 className="h1" style={{ marginTop: 8, fontSize: 28, fontWeight: 800, letterSpacing: "-0.02em" }}>
            Gestion des Établissements & Administrateurs
          </h1>
          <p className="subtitle">
            Créez de nouveaux établissements scolaires, provisionnez immédiatement leurs comptes administrateurs / direction et supervisez l&apos;ensemble du parc.
          </p>
        </div>

        <button className="btn btn--outline" type="button" onClick={() => void load()} disabled={loading || busy}>
          {loading ? "Chargement…" : "Actualiser la liste"}
        </button>
      </div>

      {/* Cartes KPI */}
      <section className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
        <article className="card" style={{ borderTop: "3px solid var(--purple)" }}>
          <p className="muted" style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 700 }}>Total Établissements</p>
          <p className="h1" style={{ marginTop: 6, fontWeight: 800, color: "var(--marine)" }}>{stats.total}</p>
          <p className="muted" style={{ marginTop: 4, fontSize: 13 }}>{stats.active} actifs · {stats.pending} en attente</p>
        </article>

        <article className="card" style={{ borderTop: "3px solid var(--marine)" }}>
          <p className="muted" style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 700 }}>Comptes Direction</p>
          <p className="h1" style={{ marginTop: 6, fontWeight: 800, color: "var(--marine)" }}>{stats.totalAdmins}</p>
          <p className="muted" style={{ marginTop: 4, fontSize: 13 }}>Administrateurs d&apos;écoles provisionnés</p>
        </article>

        <article className="card" style={{ borderTop: "3px solid var(--gold)" }}>
          <p className="muted" style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 700 }}>Sécurité & Multi-Tenant</p>
          <p className="h2" style={{ marginTop: 6, fontWeight: 800, color: "var(--marine)" }}>PostgreSQL RLS</p>
          <p className="muted" style={{ marginTop: 4, fontSize: 13 }}>Isolation étanche par école</p>
        </article>
      </section>

      {/* Alertes de notification */}
      {notice ? (
        <div className="alert alert--ok" role="status">
          {notice}
        </div>
      ) : null}
      {error ? (
        <div className="alert alert--error" role="alert">
          {error}
        </div>
      ) : null}

      {/* Boîte des identifiants créés avec bouton Copier */}
      {credentialsNotice ? (
        <div
          className="card"
          style={{
            background: "linear-gradient(135deg, var(--surface) 0%, var(--purple-soft) 100%)",
            border: "2px solid var(--purple)",
            borderRadius: "var(--radius)",
            padding: 20,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="badge badge--active">Compte direction provisionné</span>
                <span className="muted" style={{ fontSize: 12 }}>Transmettez ces accès au directeur</span>
              </div>
              <h2 className="h2" style={{ marginTop: 6, fontWeight: 800 }}>
                {credentialsNotice.schoolName}
              </h2>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                className="btn btn--primary"
                type="button"
                onClick={() => copyCredentials(credentialsNotice)}
              >
                {copied ? "✓ Identifiants copiés !" : "📋 Copier les identifiants complets"}
              </button>
              <button
                className="btn btn--ghost"
                type="button"
                onClick={() => setCredentialsNotice(null)}
              >
                Fermer
              </button>
            </div>
          </div>

          <div
            className="grid"
            style={{
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              marginTop: 16,
              background: "var(--surface)",
              padding: 16,
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--line)",
            }}
          >
            <div>
              <span className="muted" style={{ fontSize: 12 }}>Code Établissement (familles)</span>
              <div className="mono" style={{ fontWeight: 800, fontSize: 18, color: "var(--purple-deep)" }}>
                {credentialsNotice.schoolCode}
              </div>
            </div>
            <div>
              <span className="muted" style={{ fontSize: 12 }}>Adresse e-mail direction</span>
              <div style={{ fontWeight: 700, fontSize: 15, wordBreak: "break-all" }}>
                {credentialsNotice.adminEmail}
              </div>
            </div>
            <div>
              <span className="muted" style={{ fontSize: 12 }}>Nom du directeur</span>
              <div style={{ fontWeight: 600 }}>{credentialsNotice.adminName}</div>
            </div>
            <div>
              <span className="muted" style={{ fontSize: 12 }}>Mot de passe initial</span>
              <div className="mono" style={{ fontWeight: 800, fontSize: 16, color: "var(--absent)" }}>
                {credentialsNotice.password ?? "(identifiants existants)"}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Formulaire de création d'école + Direction */}
      <section className="card stack">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h2 className="h2" style={{ fontWeight: 800 }}>Créer un établissement et son administrateur</h2>
            <p className="muted" style={{ marginTop: 2, fontSize: 13 }}>
              Ajoutez une nouvelle école sur ORYA avec son code famille automatique et son compte direction dédié.
            </p>
          </div>
        </div>

        <form className="stack" onSubmit={onCreate}>
          {/* Section Établissement */}
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: "var(--marine)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.04em" }}>
              1. Informations de l&apos;école
            </div>
            <div className="grid">
              <label className="field">
                <span className="label">Nom de l&apos;école *</span>
                <input
                  className="input"
                  required
                  placeholder="Ex : Groupe Scolaire Atlas"
                  minLength={2}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>

              <label className="field">
                <span className="label">Ville *</span>
                <input
                  className="input"
                  required
                  placeholder="Ex : Casablanca, Rabat, Marrakech…"
                  minLength={2}
                  value={city}
                  onChange={(event) => setCity(event.target.value)}
                />
              </label>

              <label className="field">
                <span className="label">ICE (Identifiant fiscal, optionnel)</span>
                <input
                  className="input"
                  placeholder="Ex : 001234567000089"
                  value={ice}
                  onChange={(event) => setIce(event.target.value)}
                />
              </label>
            </div>
          </div>

          {/* Section Administrateur / Email de l'école */}
          <div style={{ marginTop: 12, paddingTop: 16, borderTop: "1px solid var(--line)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontWeight: 700 }}>
                <input
                  type="checkbox"
                  checked={withAdmin}
                  onChange={(e) => setWithAdmin(e.target.checked)}
                />
                <span>2. Créer l&apos;adresse e-mail de l&apos;administrateur / direction de cette école</span>
              </label>
              {withAdmin ? (
                <button
                  className="btn btn--ghost"
                  type="button"
                  style={{ fontSize: 12, padding: "2px 8px", height: "auto" }}
                  onClick={() => setAdminPassword(generateSecurePassword())}
                >
                  ⚡ Générer un mot de passe
                </button>
              ) : null}
            </div>

            {withAdmin ? (
              <div className="grid">
                <label className="field">
                  <span className="label">Adresse e-mail de la direction *</span>
                  <input
                    className="input"
                    type="email"
                    required={withAdmin}
                    placeholder="Ex : direction@ecole-atlas.ma"
                    value={adminEmail}
                    onChange={(event) => setAdminEmail(event.target.value)}
                  />
                  <span className="hint">Cet e-mail servira d&apos;identifiant de connexion pour la direction.</span>
                </label>

                <label className="field">
                  <span className="label">Nom complet de l&apos;administrateur / directeur</span>
                  <input
                    className="input"
                    placeholder="Ex : M. Amine Benjelloun"
                    value={adminName}
                    onChange={(event) => setAdminName(event.target.value)}
                  />
                  <span className="hint">Nom d&apos;affichage dans la console et sur les documents.</span>
                </label>

                <label className="field">
                  <span className="label">Mot de passe temporaire *</span>
                  <div style={{ display: "flex", gap: 6 }}>
                    <input
                      className="input mono"
                      type={showPassword ? "text" : "password"}
                      required={withAdmin}
                      minLength={8}
                      value={adminPassword}
                      onChange={(event) => setAdminPassword(event.target.value)}
                    />
                    <button
                      className="btn btn--outline"
                      type="button"
                      style={{ padding: "0 12px" }}
                      onClick={() => setShowPassword((prev) => !prev)}
                      title={showPassword ? "Masquer" : "Afficher"}
                    >
                      {showPassword ? "Masquer" : "Voir"}
                    </button>
                  </div>
                  <span className="hint">Au moins 8 caractères avec majuscules, chiffres et symboles.</span>
                </label>
              </div>
            ) : null}
          </div>

          {/* Option d'activation immédiate */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 14 }}>
              <input
                type="checkbox"
                checked={autoActivate}
                onChange={(e) => setAutoActivate(e.target.checked)}
              />
              <span><strong>Activer immédiatement cet établissement</strong> (la direction pourra se connecter tout de suite sans validation manuelle)</span>
            </label>
          </div>

          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn btn--primary" type="submit" disabled={busy}>
              {busy ? "Création en cours…" : "Créer l'établissement et son administrateur"}
            </button>
            <span className="hint">
              Un essai gratuit d&apos;un an est automatiquement activé avec isolation PostgreSQL RLS stricte.
            </span>
          </div>
        </form>
      </section>

      {/* Liste des écoles et de leurs comptes administrateurs */}
      <section className="card stack">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h2 className="h2" style={{ fontWeight: 800 }}>Établissements enregistrés ({schools.length})</h2>
            <p className="muted" style={{ marginTop: 2, fontSize: 13 }}>
              Supervision des codes d&apos;accès, statuts et emails de direction de chaque école.
            </p>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              className="input"
              style={{ minWidth: 260, fontSize: 14, padding: "8px 12px" }}
              placeholder="Rechercher par école, ville, code, email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search ? (
              <button className="btn btn--ghost" type="button" onClick={() => setSearch("")}>
                Effacer
              </button>
            ) : null}
          </div>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>École & Ville</th>
                <th>Code Familles</th>
                <th>Statut</th>
                <th>Abonnement</th>
                <th>Administrateurs / Emails de l&apos;école</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredSchools.map((school) => {
                const admins: SchoolAdminInfo[] = school.profiles ?? [];
                return (
                  <tr key={school.id}>
                    <td>
                      <div style={{ fontWeight: 700, fontSize: 15, color: "var(--marine)" }}>{school.name}</div>
                      <div className="muted" style={{ fontSize: 13 }}>
                        {school.city} {school.ice ? `· ICE : ${school.ice}` : ""}
                      </div>
                      <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                        Créée le {formatDate(school.createdAt)}
                      </div>
                    </td>

                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span className="mono badge badge--purple" style={{ fontSize: 13, fontWeight: 700 }}>
                          {school.code}
                        </span>
                        <button
                          type="button"
                          className="btn btn--ghost"
                          style={{ fontSize: 11, padding: "2px 6px", height: "auto" }}
                          onClick={() => {
                            void navigator.clipboard.writeText(school.code);
                            setNotice(`Code ${school.code} copié dans le presse-papier !`);
                          }}
                          title="Copier le code"
                        >
                          Copier
                        </button>
                      </div>
                    </td>

                    <td>
                      <span
                        className={
                          school.status === "active" ? "badge badge--active" : "badge badge--pending"
                        }
                      >
                        {schoolStatusLabel(school.status)}
                      </span>
                    </td>

                    <td>
                      <span className="badge badge--muted">
                        {subscriptionStatusLabel(school.subscription?.status)}
                      </span>
                    </td>

                    <td>
                      <div className="stack" style={{ gap: 6 }}>
                        {admins.length > 0 ? (
                          admins.map((adm) => (
                            <div
                              key={adm.id}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                                padding: "4px 8px",
                                borderRadius: 4,
                                background: "var(--surface)",
                                border: "1px solid var(--line)",
                                fontSize: 12,
                              }}
                            >
                              <span style={{ fontWeight: 700 }}>{adm.displayName}</span>
                              <span className="mono muted">({adm.user.email})</span>
                              {adm.user.lastLoginAt ? (
                                <span className="badge badge--active" style={{ fontSize: 10, padding: "1px 4px" }}>
                                  Actif
                                </span>
                              ) : (
                                <span className="badge badge--muted" style={{ fontSize: 10, padding: "1px 4px" }}>
                                  Jamais connecté
                                </span>
                              )}
                            </div>
                          ))
                        ) : (
                          <span className="muted" style={{ fontSize: 12, fontStyle: "italic" }}>
                            Aucun compte direction rattaché
                          </span>
                        )}

                        <div>
                          <button
                            type="button"
                            className="btn btn--outline"
                            style={{ fontSize: 11, padding: "3px 8px", minHeight: 26 }}
                            onClick={() => {
                              setSelectedSchoolForAdmin(school);
                              setModalAdminEmail(`direction@${school.name.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-")}.ma`);
                              setModalAdminName(`Direction ${school.name}`);
                              setModalAdminPassword(generateSecurePassword());
                              setModalError(null);
                            }}
                          >
                            ＋ Ajouter un compte direction
                          </button>
                        </div>
                      </div>
                    </td>

                    <td>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {school.status === "pending" ? (
                          <button
                            className="btn btn--teal"
                            type="button"
                            disabled={busy}
                            onClick={() => void onValidate(school)}
                            title="Valider l'école pour autoriser les connexions"
                          >
                            Valider
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}

              {filteredSchools.length === 0 && !loading ? (
                <tr>
                  <td colSpan={6} className="muted" style={{ textAlign: "center", padding: 32 }}>
                    {search ? `Aucun établissement ne correspond à « ${search} ».` : "Aucun établissement enregistré pour le moment."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {/* Modal / Dialog d'ajout d'administrateur à une école existante */}
      {selectedSchoolForAdmin ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(22, 58, 91, 0.45)",
            backdropFilter: "blur(2px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            zIndex: 100,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedSchoolForAdmin(null);
          }}
        >
          <div
            className="card stack"
            style={{
              width: "100%",
              maxWidth: 520,
              background: "var(--surface)",
              boxShadow: "0 10px 30px rgba(0,0,0,0.2)",
              borderRadius: "var(--radius)",
              padding: 24,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <span className="badge badge--purple">Ajout administrateur</span>
                <h2 className="h2" style={{ marginTop: 6, fontWeight: 800 }}>
                  {selectedSchoolForAdmin.name}
                </h2>
                <p className="muted" style={{ fontSize: 13 }}>
                  Créer un compte ou attribuer les droits de direction pour cette école.
                </p>
              </div>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => setSelectedSchoolForAdmin(null)}
              >
                ✕
              </button>
            </div>

            {modalError ? (
              <div className="alert alert--error" role="alert" style={{ fontSize: 13 }}>
                {modalError}
              </div>
            ) : null}

            <form className="stack" onSubmit={onAddSchoolAdmin}>
              <label className="field">
                <span className="label">Adresse e-mail de la direction *</span>
                <input
                  className="input"
                  type="email"
                  required
                  value={modalAdminEmail}
                  onChange={(e) => setModalAdminEmail(e.target.value)}
                  placeholder="Ex : direction.adjointe@ecole.ma"
                />
              </label>

              <label className="field">
                <span className="label">Nom complet de l&apos;administrateur *</span>
                <input
                  className="input"
                  required
                  value={modalAdminName}
                  onChange={(e) => setModalAdminName(e.target.value)}
                  placeholder="Ex : M. Amine Benjelloun"
                />
              </label>

              <label className="field">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span className="label">Mot de passe temporaire *</span>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    style={{ fontSize: 11, padding: "0 4px", height: "auto" }}
                    onClick={() => setModalAdminPassword(generateSecurePassword())}
                  >
                    ⚡ Régénérer
                  </button>
                </div>
                <input
                  className="input mono"
                  type="text"
                  required
                  minLength={8}
                  value={modalAdminPassword}
                  onChange={(e) => setModalAdminPassword(e.target.value)}
                />
                <span className="hint">Transmettez ce mot de passe à l&apos;administrateur.</span>
              </label>

              <div className="row" style={{ justifyContent: "flex-end", marginTop: 12, gap: 8 }}>
                <button
                  type="button"
                  className="btn btn--ghost"
                  disabled={modalBusy}
                  onClick={() => setSelectedSchoolForAdmin(null)}
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="btn btn--primary"
                  disabled={modalBusy}
                >
                  {modalBusy ? "Création en cours…" : "Créer le compte direction"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </main>
  );
}
