import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { loadAttendanceClasses } from "@/app/presences/actions";
import { AttendanceBoard } from "@/components/presences/AttendanceBoard";
import { casablancaDate } from "@/lib/demo-attendance";

export const metadata: Metadata = {
  title: "Présences",
};

async function AttendanceWithDate() {
  await connection();
  const initialLoad = await loadAttendanceClasses();
  return (
    <AttendanceBoard
      initialDate={casablancaDate()}
      initialLoad={initialLoad}
    />
  );
}

export default function PresencesPage() {
  return (
    <Suspense
      fallback={
        <p className="px-4 py-8 text-sm text-orya-night/70">
          Chargement de l&apos;appel…
        </p>
      }
    >
      <AttendanceWithDate />
    </Suspense>
  );
}
