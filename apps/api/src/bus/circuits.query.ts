import type { Prisma } from "@prisma/client";

/** t92 (CDC 3.5) : élèves des circuits ACTIFS confiés à un profil accompagnateur. */
export async function attendantStudentIds(tx: Prisma.TransactionClient, profileId: string): Promise<Set<string>> {
  const rows = await tx.busCircuitStudent.findMany({
    where: { circuit: { attendantProfileId: profileId, active: true } },
    select: { studentId: true },
  });
  return new Set(rows.map((r) => r.studentId));
}
