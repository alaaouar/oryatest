"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { listNotifications } from "@/lib/api";
import { LocaleSwitch, useI18n } from "@/lib/i18n";
import { roleLabel } from "@/lib/labels";
import { SessionProvider, useActiveProfile, useSession } from "@/lib/session";
import { SpotlightSearch } from "@/components/SpotlightSearch";
import { Logo } from "@/components/Logo";

export default function ConsoleLayout({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <Shell>{children}</Shell>
    </SessionProvider>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const { me, loading, signOut } = useSession();
  const { locale, setLocale, dir } = useI18n();
  const profile = useActiveProfile();
  const pathname = usePathname();
  const router = useRouter();
  const [unread, setUnread] = useState(0);
  // Lot 10 : menu repliable sur petit écran, refermé à chaque navigation.
  const [menuOpen, setMenuOpen] = useState(false);
  const [openNavGroup, setOpenNavGroup] = useState<string | null>(null);
  useEffect(() => {
    setMenuOpen(false);
    setOpenNavGroup(null);
  }, [pathname]);
  const activeRole = profile?.role;
  const activeSchool = profile?.schoolStatus;

  // Compteur de notifications in-app (lot 4), rafraîchi à chaque navigation.
  useEffect(() => {
    if (!activeRole || activeRole === "super_admin" || activeRole === "student" || activeSchool !== "active") return;
    let cancelled = false;
    listNotifications()
      .then((data) => {
        if (!cancelled) setUnread(data.unread);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [activeRole, activeSchool, pathname]);

  // Un établissement non validé ne donne accès à aucun écran de données :
  // l'utilisateur est renvoyé sur l'écran d'attente dédié (CDC §3.2).
  const pending =
    profile !== null && profile.role !== "super_admin" && profile.schoolStatus !== "active";

  useEffect(() => {
    if (pending && pathname !== "/pending") {
      router.replace("/pending");
    }
  }, [pending, pathname, router]);

  if (loading) {
    return (
      <main className="page">
        <p className="muted">Chargement de la session…</p>
      </main>
    );
  }

  if (!me) {
    return null;
  }

  const isSuperAdmin = profile?.role === "super_admin";
  const canReadAudit = profile?.role === "direction" || isSuperAdmin;
  const canTakeAttendance = profile?.role === "direction" || profile?.role === "teacher";
  const canAssign = profile?.role === "direction";
  const canSeeStudents = profile?.role === "direction" || profile?.role === "teacher";
  const isParent = profile?.role === "parent";
  const hasSchoolRole = !!profile && profile.role !== "super_admin" && profile.schoolStatus === "active";

  return (
    <>
      <div className="console-chrome">
        <header className="topbar" dir={dir}>
          <div className="topbar__inner">
            <div className="topbar__brand">
              <Logo size={40} tagline="Console d'établissement" href="/dashboard" className="topbar__logo" />
              <div className="topbar__search">
                <SpotlightSearch />
              </div>
            </div>

            <div className="topbar__who">
              {/* <LocaleSwitch locale={locale} setLocale={setLocale} className="topbar__locale" /> */}
              <div className="topbar__identity">
                <div className="topbar__avatar" aria-hidden="true">
                  {profile?.displayName ? profile.displayName.charAt(0).toUpperCase() : "U"}
                </div>
                <div className="topbar__identity-copy">
                  <div className="topbar__name">{profile?.displayName}</div>
                  <div className="topbar__role">
                    {profile?.schoolName ?? "ORYA"} · {roleLabel(profile?.role)}
                  </div>
                </div>
              </div>
              <button className="btn btn--outline topbar__signout" type="button" onClick={() => void signOut()}>
                {locale === "ar" ? "تسجيل الخروج" : "Se déconnecter"}
              </button>
            </div>
          </div>
        </header>

        <nav className="nav" aria-label="Navigation principale">
          <button
            type="button"
            className="nav__toggle"
            aria-expanded={menuOpen}
            aria-controls="main-nav"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span aria-hidden="true">{menuOpen ? "✕" : "☰"}</span> Menu
          </button>
          <div className="nav__inner" id="main-nav" data-open={menuOpen ? "true" : "false"}>
          <NavLink href="/dashboard" current={pathname}>
            Tableau de bord
          </NavLink>
          {isParent ? (
            <NavGroup
              label="Ma famille"
              current={pathname}
              openGroup={openNavGroup}
              setOpenGroup={setOpenNavGroup}
              links={[
                { href: "/family", label: "Mes enfants" },
                { href: "/family/agenda", label: "Agenda" },
                { href: "/family/messages", label: "Messages" },
              ]}
            />
          ) : null}
          <NavGroup
            label="Scolarité"
            current={pathname}
            openGroup={openNavGroup}
            setOpenGroup={setOpenNavGroup}
            links={[
              ...(canTakeAttendance ? [{ href: "/attendance", label: "Présences" }] : []),
              ...(canAssign ? [{ href: "/assignments", label: "Affectations" }] : []),
              ...(canSeeStudents ? [{ href: "/students", label: "Élèves" }] : []),
              ...(profile?.role === "direction" || profile?.role === "teacher"
                ? [{ href: "/resultats", label: "Notes & Évaluations" }]
                : []),
              ...(canAssign ? [{ href: "/families", label: "Familles" }] : []),
              ...(canAssign ? [{ href: "/imports", label: "Imports" }] : []),
              ...(canAssign ? [{ href: "/justifications", label: "Justificatifs" }] : []),
            ]}
          />
          <NavGroup
            label="Vie scolaire"
            current={pathname}
            openGroup={openNavGroup}
            setOpenGroup={setOpenNavGroup}
            links={[
              ...(canSeeStudents ? [{ href: "/agenda", label: "Agenda" }] : []),
              ...(canSeeStudents ? [{ href: "/messages", label: "Messages" }] : []),
              ...(profile?.role === "direction" || profile?.role === "bus_attendant" || profile?.role === "chauffeur"
                ? [{ href: "/transport", label: "Transport" }]
                : []),
              ...(profile?.role === "direction" || profile?.role === "teacher"
                ? [{ href: "/resultats", label: "Notes & Évaluations" }]
                : []),
              ...(canAssign ? [{ href: "/calendrier", label: "Calendrier" }] : []),
              ...(hasSchoolRole && profile?.role !== "student"
                ? [{ href: "/notifications", label: "Notifications", badge: unread }]
                : []),
            ]}
          />
          {profile?.role === "student" ? (
            <NavLink href="/eleve" current={pathname}>
              Mon espace
            </NavLink>
          ) : null}
          <NavGroup
            label="Établissement"
            current={pathname}
            openGroup={openNavGroup}
            setOpenGroup={setOpenNavGroup}
            links={[
              ...(profile?.role === "direction" ? [{ href: "/consentements", label: "Consentements" }] : []),
              ...(profile?.role === "direction" ? [{ href: "/massar", label: "Massar" }] : []),
              ...(profile?.role === "direction" ? [{ href: "/billing", label: "Abonnement" }] : []),
              ...(hasSchoolRole ? [{ href: "/mes-donnees", label: "Mes données" }] : []),
              ...(canReadAudit ? [{ href: "/audit", label: "Journal d’audit" }] : []),
            ]}
          />
          <NavGroup
            label="Administration ORYA"
            current={pathname}
            openGroup={openNavGroup}
            setOpenGroup={setOpenNavGroup}
            links={[
              ...(isSuperAdmin ? [{ href: "/schools", label: "Écoles" }] : []),
              ...(isSuperAdmin ? [{ href: "/platform", label: "Plateforme" }] : []),
              ...(isSuperAdmin ? [{ href: "/facturation-ecoles", label: "Facturation écoles" }] : []),
            ]}
          />
          </div>
        </nav>
      </div>

      {children}
    </>
  );
}

function NavLink({
  href,
  current,
  children,
}: {
  href: string;
  current: string;
  children: ReactNode;
}) {
  return (
    <Link className="nav__link" href={href} aria-current={isActive(href, current) ? "page" : undefined}>
      {children}
    </Link>
  );
}

type NavItem = { href: string; label: string; badge?: number };

function NavGroup({
  label,
  current,
  links,
  openGroup,
  setOpenGroup,
}: {
  label: string;
  current: string;
  links: NavItem[];
  openGroup: string | null;
  setOpenGroup: Dispatch<SetStateAction<string | null>>;
}) {
  if (links.length === 0) return null;

  const isCurrent = links.some(({ href }) => isActive(href, current));
  const isOpen = openGroup === label;
  const menuId = `nav-menu-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  return (
    <div
      className="nav__group"
      onMouseEnter={() => setOpenGroup(label)}
      onMouseLeave={() => setOpenGroup((currentGroup) => currentGroup === label ? null : currentGroup)}
      onFocus={() => setOpenGroup(label)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setOpenGroup((currentGroup) => currentGroup === label ? null : currentGroup);
        }
      }}
    >
      <button
        className="nav__group-label"
        type="button"
        aria-expanded={isOpen}
        aria-controls={menuId}
        data-active={isCurrent ? "true" : undefined}
        onClick={() => setOpenGroup(label)}
      >
        {label}
        <span className="nav__group-chevron" aria-hidden="true">⌄</span>
      </button>
      <div className="nav__menu" id={menuId} hidden={!isOpen}>
        {links.map(({ href, label: linkLabel, badge }) => (
          <NavLink key={href} href={href} current={current}>
            {linkLabel}
            {badge ? <span className="nav__badge" aria-label={`${badge} non lues`}>{badge}</span> : null}
          </NavLink>
        ))}
      </div>
    </div>
  );
}

/** Sections parent ayant leur propre entrée de menu : « Mes enfants » ne s'allume pas dessus. */
const OWN_NAV_SECTIONS = ["/family/messages", "/family/agenda"];

function isActive(href: string, current: string): boolean {
  if (current === href) return true;
  if (!current.startsWith(`${href}/`)) return false;
  return !OWN_NAV_SECTIONS.some((section) => section !== href && section.startsWith(`${href}/`) && (current === section || current.startsWith(`${section}/`)));
}
