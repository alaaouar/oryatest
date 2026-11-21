import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Suppression de compte - ORYA",
  description: "Comment supprimer votre compte ORYA et ce qu'il advient de vos donnees.",
};

/**
 * Bloc 4 : page PUBLIQUE (sans connexion) exigee par les magasins
 * d'applications. Texte a faire relire par le juriste avant publication.
 */
export default function AccountDeletionPublicPage() {
  return (
    <main className="page stack" data-testid="public-deletion">
      <h1 className="h1">Supprimer votre compte ORYA</h1>
      <section className="card stack">
        <h2 className="h2">Depuis l&apos;application</h2>
        <p>
          Connectez-vous, puis demandez la suppression de votre compte (confirmation par votre mot de passe).
          La suppression devient effective apres un delai de 14 jours, pendant lequel vous pouvez l&apos;annuler.
        </p>
        <p>
          Le compte d&apos;un eleve est supprime a la demande de son parent ou de son etablissement.
        </p>
      </section>
      <section className="card stack">
        <h2 className="h2">Sans acces a votre compte</h2>
        <p>Adressez votre demande a votre etablissement scolaire, qui la transmet a ORYA.</p>
      </section>
      <section className="card stack">
        <h2 className="h2">Ce qui est supprime ou conserve</h2>
        <p>
          Vos donnees d&apos;identification sont anonymisees. Les informations que la loi ou l&apos;etablissement doivent
          conserver (registre de suppression, journal d&apos;audit, dossier scolaire) le sont pour la duree prevue, puis supprimees.
        </p>
        <p>Avant la suppression, vous pouvez exporter vos donnees depuis la page Mes donnees.</p>
      </section>
    </main>
  );
}