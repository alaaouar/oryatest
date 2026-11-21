"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useState, type ReactNode } from "react";
import { OryaLogo } from "@/components/brand/OryaLogo";
import { LinearIcon, type IconName } from "@/components/ui/LinearIcon";
import { demoSchool, navItems } from "@/lib/demo-data";

const navIcons: Record<(typeof navItems)[number]["href"], IconName> = {
  "/": "home",
  "/presences": "clipboard",
  "/eleves": "graduation",
  "/enseignants": "users",
  "/communication": "message",
  "/agenda": "calendar",
  "/parametres": "settings",
};

export function DashboardChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const titleId = useId();

  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [menuOpen]);

  return (
    <div className="flex h-dvh overflow-hidden">
      <a
        href="#contenu-principal"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2"
      >
        Aller au contenu
      </a>

      {menuOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-30 bg-[color-mix(in_srgb,var(--orya-night)_45%,transparent)] lg:hidden"
          aria-label="Fermer le menu"
          onClick={() => setMenuOpen(false)}
        />
      ) : null}

      <aside
        id="navigation-principale"
        className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col bg-orya-night text-white transition-transform duration-200 lg:static lg:translate-x-0 ${
          menuOpen ? "max-lg:translate-x-0" : "max-lg:-translate-x-full"
        }`}
        aria-labelledby={titleId}
      >
        <div className="border-b border-white/10 px-4 py-5">
          <p id={titleId} className="sr-only">
            ORYA
          </p>
          <Link
            href="/"
            onClick={() => setMenuOpen(false)}
            className="block overflow-hidden rounded-2xl bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orya-blue"
          >
            <OryaLogo className="h-40 w-full object-cover object-center" />
          </Link>
          <p className="mt-4 px-1 text-sm font-medium text-white/85">
            Direction d&apos;établissement
          </p>
        </div>

        <nav
          aria-label="Sections ORYA"
          className="min-h-0 flex-1 overflow-y-auto px-3 py-4"
        >
          <ul className="space-y-1">
            {navItems.map((item) => {
              const isActive =
                item.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(item.href);

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setMenuOpen(false)}
                    className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                      isActive
                        ? "bg-orya-blue text-white"
                        : "text-white/80 hover:bg-white/10 hover:text-white"
                    }`}
                    aria-current={isActive ? "page" : undefined}
                  >
                    <LinearIcon
                      name={navIcons[item.href]}
                      className="h-5 w-5 shrink-0"
                    />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="border-t border-white/10 px-6 py-4 text-sm">
          <p className="font-medium">{demoSchool.name}</p>
          <p className="text-white/70">{demoSchool.city}</p>
          <p className="mt-2 text-xs leading-5 text-white/55">
            Démonstration — données fictives
          </p>
        </div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-orya-gray bg-white px-4 py-3 sm:px-6">
          <button
            type="button"
            className="orya-btn lg:hidden"
            aria-expanded={menuOpen}
            aria-controls="navigation-principale"
            aria-label={menuOpen ? "Fermer le menu" : "Ouvrir le menu"}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <LinearIcon name="menu" className="h-5 w-5" />
            Menu
          </button>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-orya-night lg:hidden">
              Direction
            </p>
            <p className="hidden text-sm text-orya-night/70 lg:block">
              Tableau de bord de démonstration
            </p>
          </div>
          <p className="rounded-full bg-orya-blue/10 px-3 py-1 text-xs font-medium text-orya-blue">
            Données fictives
          </p>
        </header>

        <div
          id="contenu-principal"
          tabIndex={-1}
          className="min-h-0 flex-1 overflow-y-auto outline-none"
        >
          {children}
        </div>
      </div>
    </div>
  );
}
