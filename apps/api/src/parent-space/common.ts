import { BadRequestException, ForbiddenException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { AuthContext } from "../auth/auth.types";

export function requireSchool(auth: AuthContext): string {
  if (!auth.schoolId) throw new ForbiddenException("Un établissement actif est requis.");
  return auth.schoolId;
}

export function civilDate(value: string, label: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new BadRequestException(`${label} invalide.`);
  }
  return date;
}

/** Filtre « enfant rattaché au compte connecté » (parent). */
export function ownChild(auth: AuthContext): Prisma.StudentWhereInput {
  return { guardians: { some: { guardian: { userId: auth.userId } } } };
}

/** Comptes parents actifs rattachés à un élève. */
export async function guardianUserIds(tx: Prisma.TransactionClient, studentId: string): Promise<string[]> {
  const links = await tx.studentGuardian.findMany({
    where: { studentId, guardian: { userId: { not: null } } },
    select: { guardian: { select: { userId: true } } },
  });
  return links.map((link) => link.guardian.userId).filter((id): id is string => !!id);
}
