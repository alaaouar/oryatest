import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/dashboard/PlaceholderPage";

export const metadata: Metadata = {
  title: "Paramètres",
};

export default function ParametresPage() {
  return (
    <PlaceholderPage
      title="Paramètres"
      summary="Les réglages de l'établissement (nom, année scolaire, utilisateurs) arriveront après la mise en place de la base de données. Rien n'est configurable aujourd'hui."
    />
  );
}
