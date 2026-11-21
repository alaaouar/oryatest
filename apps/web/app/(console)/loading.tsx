/** Lot 10 : état de chargement commun aux écrans de la console. */
export default function ConsoleLoading() {
  return (
    <main className="page">
      <p className="muted" role="status" aria-live="polite">
        Chargement…
      </p>
    </main>
  );
}
