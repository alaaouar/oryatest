import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/dashboard/PlaceholderPage";

export const metadata: Metadata = {
  title: "Agenda",
};

export default function AgendaPage() {
  return (
    <PlaceholderPage
      title="Agenda"
      summary="L'agenda scolaire (devoirs, réunions, événements) sera ajouté plus tard. Cette page est uniquement un point d'entrée de navigation."
    />
  );
}
