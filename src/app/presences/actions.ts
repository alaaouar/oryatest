"use server";

import {
  getClassRegister,
  listDemoClasses,
  saveClassRegister,
} from "@/lib/attendance-db";
import type { AttendanceStatus } from "@/lib/demo-attendance";

export async function loadAttendanceClasses() {
  try {
    return { ok: true as const, data: await listDemoClasses() };
  } catch (error) {
    return {
      ok: false as const,
      error:
        error instanceof Error
          ? error.message
          : "Impossible de charger les classes.",
    };
  }
}

export async function loadClassRegister(classId: string, date: string) {
  try {
    return { ok: true as const, data: await getClassRegister(classId, date) };
  } catch (error) {
    return {
      ok: false as const,
      error:
        error instanceof Error
          ? error.message
          : "Impossible de charger l'appel.",
    };
  }
}

export async function saveAttendanceRegister(
  classId: string,
  date: string,
  marks: Record<string, AttendanceStatus>,
) {
  try {
    await saveClassRegister(classId, date, marks);
    return { ok: true as const };
  } catch (error) {
    return {
      ok: false as const,
      error:
        error instanceof Error
          ? error.message
          : "Impossible d'enregistrer l'appel.",
    };
  }
}
