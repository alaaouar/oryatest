import type { Metadata } from "next";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import { Suspense } from "react";
import { DashboardChrome } from "@/components/dashboard/DashboardChrome";
import "./globals.css";

const plusJakarta = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta",
  subsets: ["latin"],
  display: "swap",
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "ORYA",
    template: "%s · ORYA",
  },
  description:
    "ORYA est un SaaS scolaire pour les écoles privées marocaines. Il complète la communication école-famille et ne remplace pas Massar.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="fr"
      className={`${plusJakarta.variable} ${inter.variable} h-full antialiased`}
    >
      <body className="h-full overflow-hidden bg-background font-sans text-foreground">
        <Suspense fallback={null}>
          <DashboardChrome>{children}</DashboardChrome>
        </Suspense>
      </body>
    </html>
  );
}
