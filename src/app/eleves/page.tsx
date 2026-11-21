import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/dashboard/PlaceholderPage";

export const metadata: Metadata = {
  title: "Élèves",
};

export default function ElevesPage() {
  return (
    <PlaceholderPage
      title="Élèves"
      summary="La liste des élèves d'un établissement apparaîtra ici plus tard. Pour cette démonstration, aucun élève réel n'est affiché et aucun fichier n'est connecté."
    />
  );
}
