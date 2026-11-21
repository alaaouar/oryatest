import type { Metadata } from "next";
import { demoSchool, kpis, todayEvents } from "@/lib/demo-data";

export const metadata: Metadata = {
  title: "Accueil",
};

const kpiTone: Record<(typeof kpis)[number]["id"], string> = {
  eleves: "bg-orya-blue/10 text-orya-blue",
  enseignants: "bg-orya-night/10 text-orya-night",
  absences: "bg-orya-orange/15 text-orya-orange",
  retards: "bg-orya-green/15 text-orya-green",
};

const eventTone: Record<(typeof todayEvents)[number]["id"], string> = {
  "1": "bg-orya-orange",
  "2": "bg-orya-green",
  "3": "bg-orya-blue",
};

export default function Home() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <section className="orya-card p-6 sm:p-8">
        <p className="text-sm font-medium text-orya-blue">Accueil direction</p>
        <h1 className="font-display mt-2 text-2xl font-semibold tracking-tight text-orya-night sm:text-3xl">
          Tableau de bord ORYA
        </h1>
        <p className="mt-3 max-w-3xl text-base leading-7 text-orya-night/70">
          Vue d&apos;ensemble fictive pour {demoSchool.name} ({demoSchool.city}).
          ORYA aide l&apos;école à suivre les présences, la communication avec
          les familles et l&apos;agenda.
        </p>
        <p className="mt-4 rounded-xl bg-orya-blue/8 px-4 py-3 text-sm leading-6 text-orya-night">
          {demoSchool.disclaimer}
        </p>
      </section>

      <section className="mt-8" aria-labelledby="indicateurs-titre">
        <h2
          id="indicateurs-titre"
          className="font-display text-lg font-semibold text-orya-night"
        >
          Indicateurs du jour
        </h2>
        <ul className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {kpis.map((kpi) => (
            <li key={kpi.id} className="orya-card p-5">
              <p
                className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${kpiTone[kpi.id]}`}
              >
                {kpi.label}
              </p>
              <p className="font-display mt-3 text-3xl font-semibold tracking-tight text-orya-night">
                {kpi.value}
              </p>
              <p className="mt-2 text-sm leading-6 text-orya-night/60">
                {kpi.detail}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8 pb-8" aria-labelledby="activite-titre">
        <h2
          id="activite-titre"
          className="font-display text-lg font-semibold text-orya-night"
        >
          Activité récente (fictive)
        </h2>
        <ul className="orya-card mt-4 divide-y divide-orya-gray overflow-hidden">
          {todayEvents.map((event) => (
            <li key={event.id} className="flex items-start gap-3 px-5 py-4">
              <span
                className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${eventTone[event.id]}`}
                aria-hidden="true"
              />
              <div>
                <p className="font-medium text-orya-night">{event.title}</p>
                <p className="mt-1 text-sm text-orya-night/60">{event.meta}</p>
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-orya-night/55">
          Les autres sections du menu affichent uniquement un écran
          d&apos;attente. Aucune action n&apos;enregistre encore de donnée.
        </p>
      </section>
    </main>
  );
}
