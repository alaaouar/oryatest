"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

type SearchItem = {
  id: string;
  title: string;
  category: "Actions" | "Navigation" | "Modules";
  href: string;
  icon: string;
  keywords: string;
};

const ITEMS: SearchItem[] = [
  // Actions
  { id: "act-attendance", title: "Faire l'appel des présences", category: "Actions", href: "/attendance", icon: "/checklist.svg", keywords: "appel presences absences retard session" },
  { id: "act-msg", title: "Rédiger un message ou une annonce", category: "Actions", href: "/messages", icon: "/mail.svg", keywords: "message annonce communication famille" },
  { id: "act-agenda", title: "Ajouter un devoir ou un contrôle", category: "Actions", href: "/agenda", icon: "/calendar.svg", keywords: "agenda devoir controle examen date" },
  { id: "act-justif", title: "Examiner les justificatifs d'absence", category: "Actions", href: "/justifications", icon: "/page.svg", keywords: "justificatif absence certificat maladie" },
  { id: "act-massar", title: "Préparer l'export Massar", category: "Actions", href: "/massar", icon: "/data.svg", keywords: "massar export csv xlsx ministere" },
  { id: "act-import", title: "Importer des élèves (CSV/XLSX)", category: "Actions", href: "/imports", icon: "/import.svg", keywords: "import eleves csv excel fichier" },
  
  // Navigation
  { id: "nav-dash", title: "Tableau de bord de l'établissement", category: "Navigation", href: "/dashboard", icon: "/school.svg", keywords: "tableau bord accueil stats kpi" },
  { id: "nav-students", title: "Annuaire des élèves", category: "Navigation", href: "/students", icon: "/student.svg", keywords: "eleves liste classe inscription fiche" },
  { id: "nav-families", title: "Familles & Responsables légaux", category: "Navigation", href: "/families", icon: "/parents.svg", keywords: "familles parents tuteurs responsables contact" },
  { id: "nav-assignments", title: "Affectations des enseignants", category: "Navigation", href: "/assignments", icon: "/assignment.svg", keywords: "affectations profs enseignants classes" },
  { id: "nav-transport", title: "Transport scolaire & Circuits", category: "Navigation", href: "/transport", icon: "/bus.svg", keywords: "transport bus circuits arrets accompagnateur" },
  { id: "nav-billing", title: "Abonnement & Facturation école", category: "Navigation", href: "/billing", icon: "/card.svg", keywords: "facturation contrat abonnement tarif" },
  { id: "nav-audit", title: "Journal d'audit inaltérable", category: "Navigation", href: "/audit", icon: "/lock.svg", keywords: "audit journal securite traces logs" },
  { id: "nav-data", title: "Mes données personnelles & RGPD", category: "Navigation", href: "/mes-donnees", icon: "/security.svg", keywords: "donnees cndp rgpd mot de passe 2fa" },
];

export function SpotlightSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  // Écoute Ctrl+K / Cmd+K
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Focus automatique
  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Filtrage
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ITEMS;
    return ITEMS.filter((item) =>
      item.title.toLowerCase().includes(q) ||
      item.keywords.toLowerCase().includes(q) ||
      item.category.toLowerCase().includes(q)
    );
  }, [query]);

  // Navigation clavier
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, filtered.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filtered.length) % Math.max(1, filtered.length));
    } else if (e.key === "Enter" && filtered[selectedIndex]) {
      e.preventDefault();
      goTo(filtered[selectedIndex].href);
    }
  }

  function goTo(href: string) {
    setOpen(false);
    router.push(href);
  }

  return (
    <>
      {/* Bouton recherche style Udemy dans le header */}
      <button
        type="button"
        className="udemy-search-trigger"
        onClick={() => setOpen(true)}
        aria-label="Recherche rapide"
      >
        <svg className="udemy-search-trigger__icon" aria-hidden="true" viewBox="0 0 24 24" fill="none">
          <circle cx="10.8" cy="10.8" r="6.8" />
          <path d="m16 16 4.2 4.2" />
        </svg>
        <span className="udemy-search-trigger__label">Rechercher un module, une action…</span>
        <kbd className="udemy-search-trigger__shortcut">
          Ctrl K
        </kbd>
      </button>

      {/* Modal Spotlight */}
      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 100,
            background: "rgba(28, 29, 31, 0.65)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            paddingTop: "12vh",
            paddingLeft: 16,
            paddingRight: 16,
            animation: "fadeIn 0.15s ease-out",
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 600,
              background: "var(--surface, #ffffff)",
              borderRadius: 12,
              boxShadow: "0 16px 48px rgba(0, 0, 0, 0.24)",
              border: "1px solid var(--line, #d1d7dc)",
              overflow: "hidden",
            }}
          >
            {/* Champ de saisie */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                padding: "16px 20px",
                borderBottom: "1px solid var(--line, #d1d7dc)",
                gap: 12,
              }}
            >
              <span style={{ fontSize: 18 }}>🔍</span>
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSelectedIndex(0);
                }}
                onKeyDown={handleKeyDown}
                placeholder="Où voulez-vous aller ? Tapez un mot-clé…"
                style={{
                  width: "100%",
                  border: "none",
                  outline: "none",
                  fontSize: 16,
                  color: "var(--marine, #1c1d1f)",
                  fontFamily: "inherit",
                  background: "transparent",
                }}
              />
              <button
                type="button"
                onClick={() => setOpen(false)}
                style={{
                  background: "transparent",
                  border: "none",
                  fontSize: 16,
                  cursor: "pointer",
                  color: "var(--muted, #6a6f73)",
                  padding: 4,
                }}
              >
                ✕
              </button>
            </div>

            {/* Liste des résultats */}
            <div style={{ maxHeight: 380, overflowY: "auto", padding: 8 }}>
              {filtered.length === 0 ? (
                <div style={{ padding: 32, textAlign: "center", color: "var(--muted, #6a6f73)" }}>
                  <p style={{ fontSize: 24, margin: "0 0 8px" }}>🤷‍♂️</p>
                  <p style={{ fontWeight: 600, margin: 0 }}>Aucun résultat pour « {query} »</p>
                  <p style={{ fontSize: 13, marginTop: 4 }}>Essayez avec un autre mot (appel, élève, message, export...)</p>
                </div>
              ) : (
                filtered.map((item, idx) => {
                  const isSelected = idx === selectedIndex;
                  return (
                    <div
                      key={item.id}
                      onClick={() => goTo(item.href)}
                      onMouseEnter={() => setSelectedIndex(idx)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: "10px 14px",
                        borderRadius: 8,
                        cursor: "pointer",
                        background: isSelected ? "var(--purple-soft, #f6e8ff)" : "transparent",
                        transition: "background 0.1s ease",
                      }}
                    >
                      <Image src={item.icon} alt="" aria-hidden width={20} height={20} className="svg-icon" />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: 14, color: isSelected ? "var(--purple-deep, #5022c3)" : "var(--marine, #1c1d1f)" }}>
                          {item.title}
                        </div>
                        <div style={{ fontSize: 12, color: "var(--muted, #6a6f73)" }}>
                          {item.category} · {item.href}
                        </div>
                      </div>
                      {isSelected ? (
                        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--purple-deep, #5022c3)" }}>
                          Entrée ↵
                        </span>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>

            {/* Barre de pied */}
            <div
              style={{
                padding: "10px 16px",
                background: "var(--cream, #f7f9fa)",
                borderTop: "1px solid var(--line, #d1d7dc)",
                display: "flex",
                justifyContent: "space-between",
                fontSize: 12,
                color: "var(--muted, #6a6f73)",
              }}
            >
              <span>Navigation : <kbd>↑</kbd> <kbd>↓</kbd> · Valider : <kbd>↵</kbd></span>
              <span>Fermer : <kbd>Échap</kbd></span>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
