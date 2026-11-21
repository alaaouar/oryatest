import Link from "next/link";

/** Lot 10 : page introuvable. */
export default function NotFound() {
  return (
    <main className="auth-shell">
      <div className="card auth-card stack">
        <h1 className="h1">Page introuvable</h1>
        <p className="muted">Cette adresse n&apos;existe pas ou n&apos;est plus disponible.</p>
        <Link className="btn btn--primary" href="/dashboard">
          Retour au tableau de bord
        </Link>
      </div>
    </main>
  );
}
