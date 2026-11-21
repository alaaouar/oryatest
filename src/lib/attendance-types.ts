import type { AttendanceStatus } from "@/lib/demo-attendance";

export type AttendanceClassOption = {
  id: string;
  name: string;
  cycle: string;
  studentCount: number;
};

export type AttendanceStudentRow = {
  id: string;
  code: string;
  label: string;
};

export type AttendanceRegister = {
  className: string;
  students: AttendanceStudentRow[];
  marks: Record<string, AttendanceStatus>;
  saved: boolean;
};

export type AttendanceClassesResult =
  | {
      ok: true;
      data: {
        schoolName: string;
        schoolCity: string;
        classes: AttendanceClassOption[];
      };
    }
  | { ok: false; error: string };
