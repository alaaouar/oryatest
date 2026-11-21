import { ForbiddenException, Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { AuthContext } from "../auth/auth.types";

/**
 * Bloc 4 : barriere unique de l'espace eleve, appelee a CHAQUE requete.
 * Acces seulement si le profil est un profil eleve rattache a une fiche de
 * son ecole dont le compte est "active" (consentement parental valide). Un
 * retrait de consentement suspend donc l'acces des la requete suivante, sans
 * dependre de la revocation des sessions.
 */
@Injectable()
export class StudentAccessService {
  async resolve(tx: Prisma.TransactionClient, auth: AuthContext) {
    if (auth.role !== "student" || !auth.schoolId) throw new ForbiddenException();
    const profile = await tx.userProfile.findFirst({
      where: { id: auth.profileId, userId: auth.userId, role: "student" },
      select: { student: { select: { id: true, schoolId: true, displayName: true, accountStatus: true } } },
    });
    const student = profile?.student;
    if (!student || student.schoolId !== auth.schoolId || student.accountStatus !== "active") {
      throw new ForbiddenException("Acces eleve suspendu : un consentement parental actif est requis.");
    }
    return student;
  }
}