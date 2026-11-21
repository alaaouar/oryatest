"use client";

import { schoolStatusLabel } from "@/lib/labels";
import { useActiveProfile, useSession } from "@/lib/session";

/**
 * Écran « en attente de validation » (CDC §3.2).
 *
 * Un établissement créé par ORYA reste `pending` jusqu'à vérification. Aucun
 * écran de données n'est accessible tant que ce n'est pas fait ; l'utilisateur
 * ne voit que cet écran, avec la possibilité de se déconnecter.
 */
export default function PendingPage() {
  const profile = useActiveProfile();
  const { signOut } = useSession();

  return (
    <main className="page stack">
      <div>
        <h1 className="h1">Accès en attente de validation</h1>
        <p className="subtitle">
          {profile?.schoolName ?? "Votre établissement"} · {schoolStatusLabel(profile?.schoolStatus)}
        </p>
      </div>

      <div className="alert alert--warn" role="status">
        Le choix du profil ne donne aucun droit : l&apos;accès aux données de l&apos;école sera
        ouvert dès que ORYA aura validé l&apos;établissement (vérification du nom, de
        l&apos;autorisation et de l&apos;ICE).
      </div>

      <section className="card stack">
        <h2 className="h2">Ce qui se passe maintenant</h2>
        <ol className="stack" style={{ gap: 8, marginTop: 8, paddingLeft: 20 }}>
          <li>ORYA vérifie les informations de l&apos;établissement.</li>
          <li>La direction reçoit la confirmation de validation.</li>
          <li>Les comptes de l&apos;école peuvent alors se connecter et les codes parents être émis.</li>
        </ol>
        <p className="muted">
          Aucune donnée d&apos;élève n&apos;est accessible ni collectée avant cette validation.
        </p>
      </section>

      <section className="card card--flat">
        <h2 className="h2">Besoin d&apos;aide ?</h2>
        <p className="muted" style={{ marginTop: 8 }}>
          Contactez ORYA en indiquant le nom de l&apos;établissement. Le code de l&apos;école
          est demandé : il se trouve sur le courrier de création.
        </p>
        <div className="row" style={{ marginTop: 16 }}>
          <button className="btn" type="button" onClick={() => void signOut()}>
            Se déconnecter
          </button>
        </div>
      </section>
    </main>
  );
}
