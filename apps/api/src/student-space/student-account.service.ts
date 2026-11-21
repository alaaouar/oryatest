import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { toTenantContext, type AuthContext } from "../auth/auth.types";
import type { ClientInfo } from "../auth/auth.service";
import { ActivationService } from "../activation/activation.service";
import { TenancyService } from "../core/tenancy.service";
import { requireSchool } from "../parent-space/common";

@Injectable()
export class StudentAccountService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly activation: ActivationService,
  ) {}

  /** 409 tant que le consentement parental n'est pas actif, ou si l'eleve a deja un compte. */
  async invite(auth: AuthContext, studentId: string, email: string, client: ClientInfo) {
    const schoolId = requireSchool(auth);
    const student = await this.tenancy.run(toTenantContext(auth), (tx) =>
      tx.student.findFirst({
        where: { id: studentId },
        select: { id: true, accountStatus: true, studentProfile: { select: { id: true } } },
      }),
    );
    if (!student) throw new NotFoundException("Eleve introuvable.");
    if (student.accountStatus !== "active") {
      throw new ConflictException("Compte eleve impossible : aucun consentement parental actif.");
    }
    if (student.studentProfile) throw new ConflictException("Cet eleve a deja un compte.");
    return this.activation.createInvitation({
      schoolId,
      role: "student",
      email: email.trim().toLowerCase(),
      studentId: student.id,
      createdById: auth.userId,
      profileId: auth.profileId,
      client,
    });
  }
}