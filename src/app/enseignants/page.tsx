import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/dashboard/PlaceholderPage";

export const metadata: Metadata = {
  title: "Enseignants",
};

export default function EnseignantsPage() {
  return (
    <PlaceholderPage
      title="Enseignants"
      summary="Cette section accueillera le personnel pédagogique de l'école. Le formulaire et les droits d'accès n'existent pas encore."
    />
  );
}
