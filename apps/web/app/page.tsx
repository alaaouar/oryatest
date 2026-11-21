"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ensureCsrf } from "@/lib/api";
import { Logo } from "@/components/Logo";

type InteractiveTab = "attendance" | "powerskills" | "justification";

interface DemoStudent {
  id: string;
  name: string;
  status: "present" | "absent" | "late";
}

export default function HomePage() {
  const [hasSession, setHasSession] = useState(false);
  const [activeTab, setActiveTab] = useState<InteractiveTab>("attendance");
  const [landingMenuOpen, setLandingMenuOpen] = useState(false);

  // État interactif du simulateur d'appel de classe
  const [demoStudents, setDemoStudents] = useState<DemoStudent[]>([
    { id: "1", name: "Mehdi Benjelloun", status: "present" },
    { id: "2", name: "Salma El Fassi", status: "present" },
    { id: "3", name: "Youssef Amrani", status: "absent" },
    { id: "4", name: "Amina Tazi", status: "late" },
    { id: "5", name: "Omar Chraibi", status: "present" },
    { id: "6", name: "Kenza Berrada", status: "present" },
  ]);

  // État du justificatif interactif
  const [justificationStatus, setJustificationStatus] = useState<"pending" | "accepted" | "rejected">("pending");

  useEffect(() => {
    // Vérifier discrètement si l'utilisateur a déjà une session ouverte
    void ensureCsrf().then((ok) => setHasSession(ok));
  }, []);

  function setStudentStatus(id: string, status: DemoStudent["status"]) {
    setDemoStudents((prev) => prev.map((s) => (s.id === id ? { ...s, status } : s)));
  }

  const presentCount = demoStudents.filter((s) => s.status === "present").length;
  const absentCount = demoStudents.filter((s) => s.status === "absent").length;
  const lateCount = demoStudents.filter((s) => s.status === "late").length;
  const attendanceRate = Math.round((presentCount / demoStudents.length) * 100);

  return (
    <div style={{ minHeight: "100vh", background: "#f7f8f5", color: "#203746", fontFamily: "var(--font-inter, sans-serif)" }}>
      {/* --- BANNIÈRE SESSION EXISTANTE (SI CONNECTÉ) --- */}
      {hasSession && (
        <div
          style={{
            background: "var(--marine, #163A5B)",
            color: "#ffffff",
            padding: "10px 24px",
            fontSize: 13,
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span>Vous disposez d&apos;une session active sur cette école.</span>
          <Link
            href="/dashboard"
            style={{
              color: "#ffffff",
              textDecoration: "none",
              fontWeight: 700,
            }}
          >
            Accéder à la console d&apos;établissement →
          </Link>
        </div>
      )}

      {/* --- NAVIGATION PRINCIPALE --- */}
      <header className="landing-nav">
        <div className="landing-nav__inner">
          <Logo size={36} tagline="Plateforme scolaire & familles" href="/" />

          <button
            className="landing-nav__toggle"
            type="button"
            aria-expanded={landingMenuOpen}
            aria-controls="landing-nav-links"
            onClick={() => setLandingMenuOpen((open) => !open)}
          >
            <span aria-hidden="true">{landingMenuOpen ? "✕" : "☰"}</span>
            Sections
          </button>

          <nav className="landing-nav__links" id="landing-nav-links" data-open={landingMenuOpen}>
            <a href="#fonctionnalites" className="landing-nav__link" onClick={() => setLandingMenuOpen(false)}>
              Fonctionnalités
            </a>
            <a href="#simulateur" className="landing-nav__link" onClick={() => setLandingMenuOpen(false)}>
              Démonstration live
            </a>
            <a href="#powerskills" className="landing-nav__link" onClick={() => setLandingMenuOpen(false)}>
              Fiche & Power Skills
            </a>
            <a href="#conformite" className="landing-nav__link" onClick={() => setLandingMenuOpen(false)}>
              Conformité Massar & CNDP
            </a>
            {/* <a href="#tarification" className="landing-nav__link" onClick={() => setLandingMenuOpen(false)}>
              Tarifs
            </a> */}
          </nav>

          <div className="landing-nav__actions">
            <Link href="/login" className="btn landing-nav__login">
              Se connecter
            </Link>
            <Link href="/login" className="btn btn--primary landing-nav__cta">
              Accéder à la console
            </Link>
          </div>
        </div>
      </header>

      {/* --- HERO SECTION (AUTHENTIQUE, SANS CLICHÉS IA) --- */}
      <section className="landing-hero">

        <h1 className="landing-title">
          La gestion scolaire et le lien aux familles,
          <br />
          enfin réunis au même endroit.
        </h1>

        <p className="landing-subtitle">
          Appel de classe en <strong>40 secondes chrono</strong>, signalement instantané des retards,
          cartographie des <strong>points forts académiques</strong> par élève, et export 100% compatible Massar.
          Sans SMS surtaxés, sans fuites de données.
        </p>

        <div className="landing-cta-group">
          <Link
            href="/login"
            className="btn landing-cta-button landing-cta-button--primary"
          >
            Tester la console en démo →
          </Link>

          <a
            href="#simulateur"
            className="btn landing-cta-button landing-cta-button--secondary"
          >
            Explorer le simulateur interactif
          </a>
        </div>

        {/* Bande de confiance technique */}
        <div className="landing-trust-strip">
          <div className="landing-trust-item">
            <span style={{ color: "#12A7A0" }}>✓</span>
            <span>37 politiques PostgreSQL Row Level Security (RLS)</span>
          </div>
          <div className="landing-trust-item">
            <span style={{ color: "#12A7A0" }}>✓</span>
            <span>Export certifié sans formule Massar</span>
          </div>
          <div className="landing-trust-item">
            <span style={{ color: "#12A7A0" }}>✓</span>
            <span>Espace parent bilingue Français & Arabe (RTL)</span>
          </div>
          <div className="landing-trust-item">
            <span style={{ color: "#12A7A0" }}>✓</span>
            <span>Mode hors-ligne PWA pour zones sans réseau</span>
          </div>
        </div>

        {/* --- SIMULATEUR PRODUIT INTERACTIF (SHOW, DON'T TELL) --- */}
        <div id="simulateur" className="landing-interactive-box">
          {/* Barre d'onglets du simulateur */}
          <div className="landing-tab-bar">
            <button
              type="button"
              className="landing-tab-btn"
              data-active={activeTab === "attendance"}
              onClick={() => setActiveTab("attendance")}
            >
              <span className="landing-tab-index">01</span>
              <span>Appel de classe</span>
            </button>
            <button
              type="button"
              className="landing-tab-btn"
              data-active={activeTab === "powerskills"}
              onClick={() => setActiveTab("powerskills")}
            >
              <span className="landing-tab-index">02</span>
              <span>Fiche élève & compétences</span>
            </button>
            <button
              type="button"
              className="landing-tab-btn"
              data-active={activeTab === "justification"}
              onClick={() => setActiveTab("justification")}
            >
              <span className="landing-tab-index">03</span>
              <span>Justificatifs d&apos;absence</span>
            </button>
          </div>

          <div className="landing-interactive-content">
            {/* ONGLET 1 SIMULATEUR : APPEL DE CLASSE */}
            {activeTab === "attendance" && (
              <div className="landing-demo-panel">
                <div className="landing-demo-header">
                  <div>
                    <h3 className="landing-demo-title">
                      Séance du matin · 3ème Année Collège A · Salle 14
                    </h3>
                    <div className="landing-demo-subtitle">
                      Cliquez sur les statuts pour tester la saisie en temps réel :
                    </div>
                  </div>

                  <div className="landing-attendance-summary">
                    <div className="landing-rate">
                      <span>Taux calculé</span>
                      <strong data-good={attendanceRate >= 90}>{attendanceRate}%</strong>
                    </div>
                    <div className="landing-status-summary">
                      <span className="landing-status-count landing-status-count--present">{presentCount} présents</span>
                      <span className="landing-status-count landing-status-count--absent">{absentCount} absents</span>
                      <span className="landing-status-count landing-status-count--late">{lateCount} retards</span>
                    </div>
                  </div>
                </div>

                <div className="landing-attendance-table">
                  <table className="table landing-demo-table">
                    <thead>
                      <tr>
                        <th>Élève</th>
                        <th>Statut actuel</th>
                        <th>Saisie professeur</th>
                      </tr>
                    </thead>
                    <tbody>
                      {demoStudents.map((s) => (
                        <tr key={s.id}>
                          <td>
                            <span className="landing-student-name">
                              <span className="landing-student-avatar">{s.name.split(" ").map((part) => part[0]).join("").slice(0, 2)}</span>
                              <strong>{s.name}</strong>
                            </span>
                          </td>
                          <td>
                            <span className={`landing-status-badge landing-status-badge--${s.status}`}>
                              <span className="landing-status-dot" />
                              {s.status === "present" ? "Présent" : s.status === "absent" ? "Absent" : "Retard"}
                            </span>
                          </td>
                          <td>
                            <div className="landing-attendance-actions" role="group" aria-label={`Statut de ${s.name}`}>
                              <button
                                type="button"
                                className="landing-attendance-action landing-attendance-action--present"
                                data-selected={s.status === "present"}
                                aria-pressed={s.status === "present"}
                                onClick={() => setStudentStatus(s.id, "present")}
                              >
                                Présent
                              </button>
                              <button
                                type="button"
                                className="landing-attendance-action landing-attendance-action--absent"
                                data-selected={s.status === "absent"}
                                aria-pressed={s.status === "absent"}
                                onClick={() => setStudentStatus(s.id, "absent")}
                              >
                                Absent
                              </button>
                              <button
                                type="button"
                                className="landing-attendance-action landing-attendance-action--late"
                                data-selected={s.status === "late"}
                                aria-pressed={s.status === "late"}
                                onClick={() => setStudentStatus(s.id, "late")}
                              >
                                Retard
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="landing-demo-footer">
                  <span className="landing-security-note">
                    <span aria-hidden="true">◈</span>
                    Clôture sécurisée · modification auditable par la direction
                  </span>
                  <Link href="/login" className="landing-demo-primary-btn">
                    Clôturer l&apos;appel & notifier les parents
                  </Link>
                </div>
              </div>
            )}

            {/* ONGLET 2 SIMULATEUR : FICHE ÉLÈVE & POWER SKILLS */}
            {activeTab === "powerskills" && (
              <div className="landing-demo-panel">
                <div className="landing-demo-header landing-profile-header">
                  <div>
                    <h3 className="landing-demo-title">
                      Mehdi Benjelloun · 3ème Année Collège A
                    </h3>
                    <div className="landing-demo-subtitle">
                      Code élève : <span className="mono">ELEVE-2026-089</span> · Massar : <span className="mono">M13489021</span>
                    </div>
                  </div>

                  <div className="landing-contact-actions">
                    <a
                      href="tel:+212661234567"
                      className="contact-action-btn contact-action-btn--primary"
                      onClick={(e) => { e.preventDefault(); alert("Déclencheur d'appel direct vers le père : +212 661-234567"); }}
                    >
                      📞 Appeler M. Benjelloun (Père)
                    </a>
                    <a
                      href="https://wa.me/212661234567"
                      target="_blank"
                      rel="noreferrer"
                      className="contact-action-btn contact-action-btn--whatsapp"
                      onClick={(e) => { e.preventDefault(); alert("Ouvre WhatsApp avec le modèle de message d'établissement"); }}
                    >
                      💬 WhatsApp
                    </a>
                  </div>
                </div>

                <div className="landing-skill-grid">
                  <div className="landing-skill-card landing-skill-card--green">
                    <div className="landing-skill-card__header">
                      <strong>Mathématiques</strong>
                      <span className="landing-skill-score">18.5 <small>/ 20</small></span>
                    </div>
                    <span className="power-skill-badge power-skill-badge--gold">
                      ★ Excellence & Raisonnement
                    </span>
                    <div className="landing-skill-description">
                      Top 3% de la classe en algèbre et déduction.
                    </div>
                  </div>

                  <div className="landing-skill-card landing-skill-card--blue">
                    <div className="landing-skill-card__header">
                      <strong>Physique-Chimie</strong>
                      <span className="landing-skill-score">17.0 <small>/ 20</small></span>
                    </div>
                    <span className="power-skill-badge power-skill-badge--emerald">
                      ★ Maîtrise Expérimentale
                    </span>
                    <div className="landing-skill-description">
                      Excellente intuition sur les phénomènes physiques.
                    </div>
                  </div>

                  <div className="landing-skill-card landing-skill-card--purple">
                    <div className="landing-skill-card__header">
                      <strong>Langue Arabe</strong>
                      <span className="landing-skill-score">16.5 <small>/ 20</small></span>
                    </div>
                    <span className="power-skill-badge power-skill-badge--blue">
                      ★ Analyse & Expression
                    </span>
                    <div className="landing-skill-description">
                      Vocabulaire riche et structure argumentative claire.
                    </div>
                  </div>
                </div>

                <div className="landing-skill-insight">
                  <span aria-hidden="true">✦</span>
                  Les compétences clés sont calculées automatiquement depuis les évaluations.
                </div>
              </div>
            )}

            {/* ONGLET 3 SIMULATEUR : JUSTIFICATIF & CONTRÔLE */}
            {activeTab === "justification" && (
              <div className="landing-demo-panel">
                <div className="landing-demo-header landing-justification-header">
                  <div>
                    <h3 className="landing-demo-title">
                      Justificatif d&apos;absence #JUSTIF-2026-441
                    </h3>
                    <div className="landing-demo-subtitle">
                      Déposé par Mme Tazi (Mère d&apos;Amina Tazi) · Période : 14/11 au 15/11
                    </div>
                  </div>

                  <div>
                    {justificationStatus === "pending" && <span className="landing-review-status landing-review-status--pending"><span />En attente de revue</span>}
                    {justificationStatus === "accepted" && <span className="landing-review-status landing-review-status--accepted"><span />✓ Accepté par la direction</span>}
                    {justificationStatus === "rejected" && <span className="landing-review-status landing-review-status--rejected"><span />Refusé</span>}
                  </div>
                </div>

                <div className="landing-document-card">
                  <div className="landing-document-icon" aria-hidden="true">PDF</div>
                  <div className="landing-document-content">
                    <div className="landing-document-motif">
                      <span>Motif déclaré</span>
                      <strong>« Consultation médicale pédiatrique pour état fébrile aigu. Certificat ci-joint. »</strong>
                    </div>
                    <div className="landing-document-meta">
                      <span className="landing-file-name">Certificat_Medical_14Nov.pdf <small>245 Ko</small></span>
                      <span className="landing-security-chip landing-security-chip--safe">✓ Fichier sain</span>
                      <span className="landing-security-chip">AES-256</span>
                    </div>
                  </div>
                </div>

                <div className="landing-review-actions">
                  <button
                    type="button"
                    className="landing-review-btn landing-review-btn--accept"
                    data-selected={justificationStatus === "accepted"}
                    onClick={() => setJustificationStatus("accepted")}
                  >
                    <span aria-hidden="true">✓</span>
                    Valider le justificatif
                  </button>
                  <button
                    type="button"
                    className="landing-review-btn landing-review-btn--reject"
                    data-selected={justificationStatus === "rejected"}
                    onClick={() => setJustificationStatus("rejected")}
                  >
                    Refuser avec motif
                  </button>
                  <button
                    type="button"
                    className="landing-review-btn landing-review-btn--reset"
                    onClick={() => setJustificationStatus("pending")}
                  >
                    Réinitialiser
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* --- SECTIONS FONCTIONNALITÉS --- */}
      <section id="fonctionnalites" className="landing-section">
        <div className="landing-section__header">
          <span className="muted" style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Conçu pour l&apos;Écosystème Marocain
          </span>
          <h2 className="landing-section__title">
            Quatre piliers fondamentaux pour votre établissement
          </h2>
          <p className="landing-section__intro">
            Une architecture logicielle sobre et robuste, évitant le superflu pour se concentrer sur l&apos;efficacité opérationnelle.
          </p>
        </div>

        <article className="landing-feature" aria-labelledby="landing-feature-attendance">
          <div className="landing-feature__inner">
            <div className="landing-feature__icon" aria-hidden="true">⏱</div>
            <div className="landing-feature__content">
              <span className="landing-feature__eyebrow">01 · Présence et ponctualité</span>
              <h3 id="landing-feature-attendance">Un suivi des présences simple et réactif</h3>
              <p>
                Appel sur mobile ou ordinateur en moins de 40 secondes. Rappel automatisé à 7h45 pour les enseignants.
                Synchronisation hors-ligne PWA pour les zones blanches de l&apos;école.
              </p>
              <strong>Zéro feuille d&apos;appel perdue</strong>
            </div>
          </div>
        </article>

        <article id="powerskills" className="landing-feature landing-feature--alternate" aria-labelledby="landing-feature-powerskills">
          <div className="landing-feature__inner">
            <div className="landing-feature__icon landing-feature__icon--gold" aria-hidden="true">⭐</div>
            <div className="landing-feature__content">
              <span className="landing-feature__eyebrow">02 · Suivi des élèves</span>
              <h3 id="landing-feature-powerskills">Des profils qui révèlent le potentiel de chaque élève</h3>
              <p>
                Détection automatisée des matières d&apos;excellence et des axes de renforcement à partir des notes réelles.
                Accès immédiat en 1 clic aux téléphones et WhatsApp des parents pour les enseignants.
              </p>
              <strong>Une vue à 360° de chaque élève</strong>
            </div>
          </div>
        </article>

        <article className="landing-feature" aria-labelledby="landing-feature-families">
          <div className="landing-feature__inner">
            <div className="landing-feature__icon landing-feature__icon--teal" aria-hidden="true">💬</div>
            <div className="landing-feature__content">
              <span className="landing-feature__eyebrow">03 · Lien avec les familles</span>
              <h3 id="landing-feature-families">Une communication directe avec les familles</h3>
              <p>
                Dépôt de justificatifs médicaux avec analyse antivirus ClamAV en temps réel.
                Espace parents bilingue (Français et Arabe RTL natif) avec accusés de lecture et de réception.
              </p>
              <strong>Sans coût SMS imposé</strong>
            </div>
          </div>
        </article>

        <article id="conformite" className="landing-feature landing-feature--alternate" aria-labelledby="landing-feature-compliance">
          <div className="landing-feature__inner">
            <div className="landing-feature__icon landing-feature__icon--slate" aria-hidden="true">
              <Image src="/security.svg" alt="" width={28} height={28} className="svg-icon" />
            </div>
            <div className="landing-feature__content">
              <span className="landing-feature__eyebrow">04 · Conformité et protection</span>
              <h3 id="landing-feature-compliance">Des données protégées et des exports conformes</h3>
              <p>
                Export propre vérifié sans formules dangereuses pour la saisie Massar.
                Isolation stricte des données par école (PostgreSQL Row Level Security) conforme à la Loi 09-08.
              </p>
              <strong>Souveraineté des données de votre établissement</strong>
            </div>
          </div>
        </article>
      </section>

      {/* --- SECTION TARIFICATION CLAIRE (B2B SAAS) --- */}
      {/* <section id="tarification" className="landing-section" style={{ background: "#ffffff", borderTop: "1px solid #e5e7eb", borderBottom: "1px solid #e5e7eb" }}>
        <div className="landing-section__header">
          <span className="muted" style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Modèle Économique Transparent
          </span>
          <h2 style={{ fontSize: 32, fontWeight: 800, margin: "10px 0 16px", letterSpacing: "-0.02em" }}>
            Une tarification claire pour les établissements
          </h2>
          <p className="muted" style={{ fontSize: 16 }}>
            Facturation annuelle directe à l&apos;école avec émission de facture et TVA marocaine (20%). Aucun paiement réclamé aux familles.
          </p>
        </div>

        <div style={{ maxWidth: 520, margin: "0 auto" }}>
          <div
            className="card"
            style={{
              padding: "36px",
              borderTop: "5px solid var(--teal, #12A7A0)",
              textAlign: "center",
              display: "flex",
              flexDirection: "column",
              gap: 20,
            }}
          >
            <div>
              <span className="badge badge--active" style={{ fontSize: 12 }}>
                Formule Partenaire Annuelle
              </span>
              <div style={{ marginTop: 14 }}>
                <span style={{ fontSize: 44, fontWeight: 800, color: "#203746" }}>100 DH</span>
                <span className="muted" style={{ fontSize: 14 }}> HT / élève / an</span>
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                (Soit 120 DH TTC · Règlement par virement bancaire de l&apos;école)
              </div>
            </div>

            <ul className="list-reset stack" style={{ gap: 10, textAlign: "left", fontSize: 14, margin: "10px 0" }}>
              <li style={{ display: "flex", gap: 10 }}>
                <span style={{ color: "#16a34a", fontWeight: 700 }}>✓</span>
                <span>Console direction & administration illimitée</span>
              </li>
              <li style={{ display: "flex", gap: 10 }}>
                <span style={{ color: "#16a34a", fontWeight: 700 }}>✓</span>
                <span>Accès enseignants pour l&apos;appel, devoirs et évaluations</span>
              </li>
              <li style={{ display: "flex", gap: 10 }}>
                <span style={{ color: "#16a34a", fontWeight: 700 }}>✓</span>
                <span>Espace parents bilingue sans abonnement pour les familles</span>
              </li>
              <li style={{ display: "flex", gap: 10 }}>
                <span style={{ color: "#16a34a", fontWeight: 700 }}>✓</span>
                <span>Module circuits de transport scolaire et feuilles de route</span>
              </li>
              <li style={{ display: "flex", gap: 10 }}>
                <span style={{ color: "#16a34a", fontWeight: 700 }}>✓</span>
                <span>Exports Massar validés & sauvegardes chiffrées</span>
              </li>
            </ul>

            <Link
              href="/login"
              className="btn btn--primary"
              style={{
                padding: "12px 24px",
                fontSize: 15,
                fontWeight: 700,
                background: "var(--marine, #163A5B)",
                color: "#ffffff",
                border: "none",
              }}
            >
              Demander un accès pilote pour votre école →
            </Link>
          </div>
        </div>
      </section> */}

      {/* --- FOOTER SANS FRICTION --- */}
      <footer style={{ background: "#163a5b", color: "#ffffff", padding: "48px 24px 32px" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 32 }}>
          <div style={{ maxWidth: 360 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div className="wordmark" style={{ color: "#ffffff", fontSize: 24 }}>
                ORIA<span className="dot" style={{ color: "var(--teal, #12A7A0)" }}>.</span>
              </div>
            </div>
            <p style={{ fontSize: 13, color: "#9ca3af", marginTop: 10, lineHeight: 1.5 }}>
              Plateforme SaaS d&apos;établissement scolaire reliant la direction, les enseignants et les familles.
              Conçue pour les écoles privées marocaines dans le respect de la Loi 09-08 et du CDC v2.0.
            </p>
          </div>

          <div style={{ display: "flex", gap: 48, flexWrap: "wrap", fontSize: 13 }}>
            <div>
              <div style={{ fontWeight: 700, marginBottom: 12, color: "#ffffff" }}>Modules</div>
              <ul className="list-reset stack" style={{ gap: 8, color: "#9ca3af" }}>
                <li><Link href="/attendance" style={{ color: "inherit", textDecoration: "none" }}>Appel & Présences</Link></li>
                <li><Link href="/students" style={{ color: "inherit", textDecoration: "none" }}>Fiches Élèves & Power Skills</Link></li>
                <li><Link href="/resultats" style={{ color: "inherit", textDecoration: "none" }}>Résultats d&apos;Évaluations</Link></li>
                <li><Link href="/transport" style={{ color: "inherit", textDecoration: "none" }}>Circuits de Transport</Link></li>
              </ul>
            </div>

            <div>
              <div style={{ fontWeight: 700, marginBottom: 12, color: "#ffffff" }}>Accès direct</div>
              <ul className="list-reset stack" style={{ gap: 8, color: "#9ca3af" }}>
                <li><Link href="/login" style={{ color: "inherit", textDecoration: "none" }}>Connexion Console</Link></li>
                <li><Link href="/activation" style={{ color: "inherit", textDecoration: "none" }}>Activation Compte Famille</Link></li>
                <li><Link href="/bienvenue" style={{ color: "inherit", textDecoration: "none" }}>Première ouverture (Langue & Profil)</Link></li>
                <li><Link href="/mot-de-passe-oublie" style={{ color: "inherit", textDecoration: "none" }}>Mot de passe oublié</Link></li>
              </ul>
            </div>

            <div>
              <div style={{ fontWeight: 700, marginBottom: 12, color: "#ffffff" }}>Réglementation</div>
              <ul className="list-reset stack" style={{ gap: 8, color: "#9ca3af" }}>
                <li>Protection des données (Loi 09-08)</li>
                <li>Hébergement souverain & RLS</li>
                <li>Politique de confidentialité</li>
                <li>Registre d&apos;anonymisation</li>
              </ul>
            </div>
          </div>
        </div>

        <div
          style={{
            maxWidth: 1200,
            margin: "36px auto 0",
            paddingTop: 24,
            borderTop: "1px solid #374151",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 12,
            color: "#6b7280",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <span>© 2026 ORYA. Tous droits réservés. L&apos;école et la famille, au même endroit.</span>
          <span>Version candidate 1.0 (CDC v2.0)</span>
        </div>
      </footer>
    </div>
  );
}
