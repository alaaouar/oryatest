import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/dashboard/PlaceholderPage";

export const metadata: Metadata = {
  title: "Communication",
};

export default function CommunicationPage() {
  return (
    <PlaceholderPage
      title="Communication"
      summary="Les messages entre l'école et les familles seront gérés ici. Aucun envoi de notification n'est possible pour le moment."
    />
  );
}
