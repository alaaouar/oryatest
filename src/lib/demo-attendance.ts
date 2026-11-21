export type AttendanceStatus = "present" | "absent" | "late";

export type DemoStudent = {
  id: string;
  label: string;
};

export type DemoClass = {
  id: string;
  name: string;
  cycle: string;
  students: DemoStudent[];
};

export const attendanceStatuses: {
  id: AttendanceStatus;
  label: string;
}[] = [
  { id: "present", label: "Présent" },
  { id: "absent", label: "Absent" },
  { id: "late", label: "Retard" },
];

export const demoClasses: DemoClass[] = [
  {
    id: "4e-a",
    name: "4ᵉ A",
    cycle: "Collège",
    students: [
      { id: "4e-a-01", label: "Élève démo 01" },
      { id: "4e-a-02", label: "Élève démo 02" },
      { id: "4e-a-03", label: "Élève démo 03" },
      { id: "4e-a-04", label: "Élève démo 04" },
      { id: "4e-a-05", label: "Élève démo 05" },
      { id: "4e-a-06", label: "Élève démo 06" },
      { id: "4e-a-07", label: "Élève démo 07" },
      { id: "4e-a-08", label: "Élève démo 08" },
    ],
  },
  {
    id: "2e-b",
    name: "2ᵉ collège B",
    cycle: "Collège",
    students: [
      { id: "2e-b-01", label: "Élève démo 11" },
      { id: "2e-b-02", label: "Élève démo 12" },
      { id: "2e-b-03", label: "Élève démo 13" },
      { id: "2e-b-04", label: "Élève démo 14" },
      { id: "2e-b-05", label: "Élève démo 15" },
      { id: "2e-b-06", label: "Élève démo 16" },
    ],
  },
  {
    id: "tc-1",
    name: "Tronc commun 1",
    cycle: "Lycée",
    students: [
      { id: "tc-1-01", label: "Élève démo 21" },
      { id: "tc-1-02", label: "Élève démo 22" },
      { id: "tc-1-03", label: "Élève démo 23" },
      { id: "tc-1-04", label: "Élève démo 24" },
      { id: "tc-1-05", label: "Élève démo 25" },
    ],
  },
  {
    id: "atelier",
    name: "Atelier démo (vide)",
    cycle: "Activité",
    students: [],
  },
];

export function casablancaDate(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Casablanca",
  }).format(date);
}

export function registerKey(classId: string, date: string): string {
  return `${classId}|${date}`;
}
