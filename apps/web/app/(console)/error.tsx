"use client";

import Link from "next/link";

/** Lot 10 : erreur inattendue d'un écran de la console (au lieu d'une page blanche). */
export default function ConsoleError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="page error-page">
      <section className="error-card" aria-labelledby="console-error-title">
        <div className="error-card__icon" aria-hidden="true">!</div>
        <p className="error-card__eyebrow">Oups, petit imprévu</p>
        <h1 className="error-card__title" id="console-error-title">Cette page n’a pas pu s’afficher</h1>
        <p className="error-card__message" role="alert">
          Une erreur inattendue est survenue. Réessayez, ou retournez au tableau de bord.
        </p>
        {error.digest ? <p className="error-card__reference">Référence : {error.digest}</p> : null}
        <div className="error-card__actions">
          <button className="btn btn--primary" type="button" onClick={() => reset()}>
            Réessayer
          </button>
          <Link className="btn error-card__back" href="/dashboard">
            Retour au tableau de bord
          </Link>
        </div>
      </section>
    </main>
  );
}
