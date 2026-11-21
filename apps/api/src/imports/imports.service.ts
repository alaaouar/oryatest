import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PlanLimitsService } from "../billing/plan-limits.service";
import { TenancyService } from "../core/tenancy.service";
import { AuditService } from "../audit/audit.service";
import { StorageService } from "../storage/storage.service";
import { toTenantContext, type AuthContext } from "../auth/auth.types";
import type { ClientInfo } from "../auth/auth.service";
import {
  parseGuardianWorkbook,
  parseWorkbook,
  type ParsedGuardianRow,
  type ParsedStudentRow,
  type RowError,
} from "./import-parser";
import { inspectZip, isXlsx, looksLikeZip } from "./zip-guard";
import type { StartImportDto } from "./imports.dto";

/** 5 Mo = 5 000 000 octets (mégoctet SI), conforme au CDC / lot2-proposal. */
const MAX_BYTES = Number(process.env.IMPORT_MAX_BYTES ?? 5_000_000);
const MAX_ROWS = Number(process.env.IMPORT_MAX_ROWS ?? 5000);
const ALLOWED_EXTENSION = /\.(csv|xlsx)$/i;
const PREVIEW_ROWS = 20;
const MAX_ERRORS_RETURNED = 200;

type ImportSummary = {
  id: string;
  status: string;
  schoolYear: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  kind: ImportKind;
  preview: Array<ParsedStudentRow | ParsedGuardianRow>;
  errors: RowError[];
};

type ImportKind = "students" | "guardians";

const MAX_GUARDIANS_PER_STUDENT = 2;

/**
 * Import Excel/CSV en deux temps (CDC §4 M2) :
 *   1. `start` : lecture, normalisation, **aperçu** et rapport d'erreurs ;
 *   2. `commit` : écriture réelle, idempotente (upsert par code élève).
 *
 * Les lignes normalisées sont stockées dans le job : le fichier n'est jamais
 * conservé sur disque ni relu au moment du commit.
 */
@Injectable()
export class ImportsService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly limits: PlanLimitsService,
  ) {}

  async start(auth: AuthContext, dto: StartImportDto, client: ClientInfo): Promise<ImportSummary> {
    const context = toTenantContext(auth);

    if (!auth.schoolId) {
      throw new ForbiddenException("Un import exige un établissement actif.");
    }

    if (!ALLOWED_EXTENSION.test(dto.filename)) {
      throw new BadRequestException("Seuls les fichiers .csv et .xlsx sont acceptés.");
    }

    // Estimation avant décodage : refuse tôt un payload base64 trop long
    // (évite d'allouer un buffer inutile et couvre les clients qui envoient
    // déjà plus de 5 Mo encodés).
    const estimatedBytes = Math.floor((dto.contentBase64.length * 3) / 4);
    if (estimatedBytes > MAX_BYTES) {
      throw new PayloadTooLargeException(
        `Fichier trop volumineux (~${Math.round(estimatedBytes / 1024)} Ko) : ${Math.round(MAX_BYTES / 1_000_000)} Mo maximum.`,
      );
    }

    const buffer = Buffer.from(dto.contentBase64, "base64");

    if (buffer.length === 0) {
      throw new BadRequestException("Fichier vide ou encodage base64 invalide.");
    }
    if (buffer.length > MAX_BYTES) {
      throw new PayloadTooLargeException(
        `Fichier trop volumineux (${Math.round(buffer.length / 1024)} Ko) : ${Math.round(MAX_BYTES / 1_000_000)} Mo maximum.`,
      );
    }

    // t52u : ordre des controles = taille (ci-dessus), puis metadonnees ZIP du
    // repertoire central SANS decompression (entrees, taille declaree, ratio, chemins),
    // AVANT l'antivirus : une bombe ZIP est refusee (400) sans etre confiee a clamd.
    // Toute archive ZIP est controlee, quel que soit le nom (.xlsx ou .csv deguise).
    const xlsxName = /\.xlsx$/i.test(dto.filename);
    if (looksLikeZip(buffer)) {
      const zipGuard = inspectZip(buffer, { requireOoxml: xlsxName });
      if (!zipGuard.ok) {
        throw new BadRequestException(`Fichier refusé : ${zipGuard.reason}.`);
      }
    }

    // Bloc 3b : antivirus sur tous les octets AVANT la detection du type ;
    // le contenu n'est jamais stocke ni servi (analyse seule, echec ferme : 422 / 503).
    try {
      await this.storage.scanOnly(buffer);
    } catch (error) {
      if (error instanceof UnprocessableEntityException) {
        await this.audit.scoped(context, {
          action: "file.rejected.infected",
          entity: "School",
          entityId: auth.schoolId,
          severity: "warning",
          metadata: { purpose: "import" },
          ip: client.ip,
          userAgent: client.userAgent,
        });
      }
      throw error;
    }

    // Detection du type (apres l'antivirus) : un .xlsx doit etre une archive ZIP,
    // deja controlee ci-dessus sur ses metadonnees.
    if (xlsxName && !isXlsx(buffer)) {
      throw new BadRequestException("Fichier .xlsx invalide : archive ZIP attendue.");
    }

    const kind: ImportKind = dto.kind ?? "students";
    let parsed: { totalRows: number; rows: Array<ParsedStudentRow | ParsedGuardianRow>; errors: RowError[] };
    try {
      parsed =
        kind === "guardians"
          ? await parseGuardianWorkbook(dto.filename, buffer)
          : await parseWorkbook(dto.filename, buffer);
    } catch (error) {
      throw new BadRequestException(
        `Fichier illisible : ${error instanceof Error ? error.message : "format inconnu"}.`,
      );
    }

    if (parsed.totalRows > MAX_ROWS) {
      throw new BadRequestException(
        `Trop de lignes (${parsed.totalRows}) : ${MAX_ROWS} maximum par import.`,
      );
    }

    // En-tête invalide : refus immédiat (400). Les erreurs de ligne restent
    // dans le rapport d'aperçu ; l'absence de colonnes obligatoires empêche
    // toute création de job.
    const missingColumns = parsed.errors.find(
      (error) => error.line === 1 && error.message.startsWith("colonnes obligatoires absentes"),
    );
    if (missingColumns) {
      throw new BadRequestException(missingColumns.message);
    }

    const schoolId = auth.schoolId;

    // 2.1b : chaque ligne responsable doit viser un élève existant de l'école.
    if (kind === "guardians" && parsed.rows.length > 0) {
      const codes = [...new Set((parsed.rows as ParsedGuardianRow[]).map((row) => row.studentCode))];
      const known = await this.tenancy.run(context, (tx) =>
        tx.student.findMany({ where: { studentCode: { in: codes } }, select: { studentCode: true } }),
      );
      const knownCodes = new Set(known.map((entry) => entry.studentCode));
      const kept: ParsedGuardianRow[] = [];
      for (const row of parsed.rows as ParsedGuardianRow[]) {
        if (knownCodes.has(row.studentCode)) {
          kept.push(row);
        } else {
          parsed.errors.push({
            line: row.line,
            column: "code élève",
            message: `élève introuvable dans l'établissement (${row.studentCode})`,
          });
        }
      }
      parsed.rows = kept;
      parsed.errors.sort((a, b) => a.line - b.line);
    }

    const job = await this.tenancy.run(context, async (tx) => {
      const created = await tx.importJob.create({
        data: {
          schoolId,
          createdById: auth.userId,
          filename: dto.filename.slice(0, 160),
          kind,
          schoolYear: dto.schoolYear,
          totalRows: parsed.totalRows,
          validRows: parsed.rows.length,
          invalidRows: parsed.errors.length,
          normalizedRows: parsed.rows as unknown as Prisma.InputJsonValue,
        },
        select: { id: true },
      });

      if (parsed.errors.length > 0) {
        await tx.importRowError.createMany({
          data: parsed.errors.map((error) => ({
            schoolId,
            jobId: created.id,
            line: error.line,
            column: error.column ?? null,
            message: error.message.slice(0, 300),
          })),
        });
      }

      return created;
    });

    await this.audit.scoped(context, {
      action: "import.started",
      entity: "ImportJob",
      entityId: job.id,
      metadata: {
        filename: dto.filename,
        kind,
        schoolYear: dto.schoolYear,
        totalRows: parsed.totalRows,
        validRows: parsed.rows.length,
        invalidRows: parsed.errors.length,
      },
      ip: client.ip,
      userAgent: client.userAgent,
    });

    return {
      id: job.id,
      status: "preview",
      kind,
      schoolYear: dto.schoolYear,
      totalRows: parsed.totalRows,
      validRows: parsed.rows.length,
      invalidRows: parsed.errors.length,
      preview: parsed.rows.slice(0, PREVIEW_ROWS),
      errors: parsed.errors.slice(0, MAX_ERRORS_RETURNED),
    };
  }

  async get(auth: AuthContext, jobId: string) {
    const job = await this.tenancy.run(toTenantContext(auth), (tx) =>
      tx.importJob.findFirst({
        where: { id: jobId },
        select: {
          id: true,
          filename: true,
          kind: true,
          status: true,
          schoolYear: true,
          totalRows: true,
          validRows: true,
          invalidRows: true,
          committedAt: true,
          createdAt: true,
          normalizedRows: true,
          errors: {
            orderBy: { line: "asc" },
            take: MAX_ERRORS_RETURNED,
            select: { line: true, column: true, message: true },
          },
        },
      }),
    );

    if (!job) {
      throw new NotFoundException("Import introuvable.");
    }

    const rows = (job.normalizedRows as unknown as ParsedStudentRow[] | null) ?? [];

    return {
      id: job.id,
      filename: job.filename,
      kind: job.kind,
      status: job.status,
      schoolYear: job.schoolYear,
      totalRows: job.totalRows,
      validRows: job.validRows,
      invalidRows: job.invalidRows,
      committedAt: job.committedAt,
      createdAt: job.createdAt,
      preview: rows.slice(0, PREVIEW_ROWS),
      errors: job.errors,
    };
  }

  async commit(auth: AuthContext, jobId: string, client: ClientInfo) {
    const context = toTenantContext(auth);

    if (!auth.schoolId) {
      throw new ForbiddenException("Un import exige un établissement actif.");
    }

    const schoolId = auth.schoolId;

    const result = await this.tenancy.run(context, async (tx) => {
      const job = await tx.importJob.findFirst({
        where: { id: jobId },
        select: { id: true, status: true, kind: true, schoolYear: true, normalizedRows: true },
      });

      if (!job) {
        throw new NotFoundException("Import introuvable.");
      }
      if (job.status !== "preview") {
        throw new ConflictException("Cet import a déjà été validé ou annulé.");
      }

      const rows = (job.normalizedRows as unknown as ParsedStudentRow[] | null) ?? [];
      if (rows.length === 0) {
        throw new BadRequestException("Aucune ligne valide à importer.");
      }

      if (job.kind === "guardians") {
        const guardianResult = await this.commitGuardians(
          tx,
          schoolId,
          job.normalizedRows as unknown as ParsedGuardianRow[],
        );
        await tx.importJob.update({
          where: { id: job.id },
          data: { status: "committed", committedAt: new Date() },
        });
        return { kind: "guardians" as const, ...guardianResult };
      }

      // Lot 9 : limite d'élèves du plan (402 si dépassée).
      const codes = [...new Set(rows.map((row) => row.studentCode))];
      const known = await tx.student.count({ where: { studentCode: { in: codes } } });
      await this.limits.assertCapacity(tx, schoolId, "students", codes.length - known);

      const classrooms = new Set<string>();
      const students = new Set<string>();
      let enrollments = 0;
      // Lot 8 : un code Massar déjà enregistré n'est jamais remplacé par un import.
      const massarPreserved: string[] = [];

      for (const row of rows) {
        const classroom = await tx.classroom.upsert({
          where: { schoolId_name: { schoolId, name: row.classroom } },
          update: { cycle: row.cycle ?? null, level: row.level ?? null },
          create: { schoolId, name: row.classroom, cycle: row.cycle ?? null, level: row.level ?? null },
          select: { id: true },
        });
        classrooms.add(classroom.id);

        const birthDate = row.birthDate ? new Date(`${row.birthDate}T00:00:00.000Z`) : null;

        // Réimport : un code Massar déjà enregistré n'est jamais effacé si la
        // nouvelle ligne n'en fournit pas (CDC §4 M2 / lot2-proposal).
        const studentUpdate: Prisma.StudentUpdateInput = {
          displayName: row.displayName,
          birthDate,
        };
        if (row.massarCode) {
          const existing = await tx.student.findUnique({
            where: { schoolId_studentCode: { schoolId, studentCode: row.studentCode } },
            select: { massarCode: true },
          });
          if (existing?.massarCode && existing.massarCode !== row.massarCode) {
            massarPreserved.push(row.studentCode);
          } else {
            studentUpdate.massarCode = row.massarCode;
          }
        }

        const student = await tx.student.upsert({
          where: { schoolId_studentCode: { schoolId, studentCode: row.studentCode } },
          update: studentUpdate,
          create: {
            schoolId,
            studentCode: row.studentCode,
            displayName: row.displayName,
            massarCode: row.massarCode ?? null,
            birthDate,
          },
          select: { id: true },
        });
        students.add(student.id);

        await tx.enrollment.upsert({
          where: { studentId_schoolYear: { studentId: student.id, schoolYear: job.schoolYear } },
          update: { classroomId: classroom.id, schoolId },
          create: {
            schoolId,
            studentId: student.id,
            classroomId: classroom.id,
            schoolYear: job.schoolYear,
          },
        });
        enrollments += 1;
      }

      await tx.importJob.update({
        where: { id: job.id },
        data: { status: "committed", committedAt: new Date() },
      });

      return {
        kind: "students" as const,
        classrooms: classrooms.size,
        students: students.size,
        enrollments,
        massarPreserved: massarPreserved.length,
        massarPreservedCodes: massarPreserved.slice(0, 50),
      };
    });

    await this.audit.scoped(context, {
      action: "import.committed",
      entity: "ImportJob",
      entityId: jobId,
      metadata: result,
      ip: client.ip,
      userAgent: client.userAgent,
    });

    return { ok: true, ...result };
  }

  /**
   * 2.1b : rattache chaque ligne à un responsable existant (même e-mail, ou même
   * nom + téléphone) ou en crée un. Respecte la limite de 2 responsables par
   * élève sans lever d'erreur (sinon la transaction entière serait annulée) :
   * les lignes non applicables sont rapportées dans `skipped`.
   */
  private async commitGuardians(tx: Prisma.TransactionClient, schoolId: string, rows: ParsedGuardianRow[]) {
    let guardiansCreated = 0;
    let guardiansReused = 0;
    let links = 0;
    const skipped: { line: number; reason: string }[] = [];

    for (const row of rows) {
      const student = await tx.student.findFirst({
        where: { studentCode: row.studentCode },
        select: { id: true },
      });
      if (!student) {
        skipped.push({ line: row.line, reason: "élève introuvable" });
        continue;
      }

      let guardian = row.email
        ? await tx.guardian.findFirst({ where: { email: row.email }, select: { id: true, phone: true, address: true } })
        : null;
      if (!guardian && row.phone) {
        guardian = await tx.guardian.findFirst({
          where: { phone: row.phone, fullName: { equals: row.fullName, mode: "insensitive" } },
          select: { id: true, phone: true, address: true },
        });
      }
      if (!guardian) {
        guardian = await tx.guardian.findFirst({
          where: {
            fullName: { equals: row.fullName, mode: "insensitive" },
            students: { some: { studentId: student.id } },
          },
          select: { id: true, phone: true, address: true },
        });
      }

      if (guardian) {
        guardiansReused += 1;
        const fill: Prisma.GuardianUpdateInput = {};
        if (!guardian.phone && row.phone) fill.phone = row.phone;
        if (!guardian.address && row.address) fill.address = row.address;
        if (Object.keys(fill).length > 0) {
          await tx.guardian.update({ where: { id: guardian.id }, data: fill });
        }
      } else {
        guardian = await tx.guardian.create({
          data: {
            schoolId,
            fullName: row.fullName,
            email: row.email ?? null,
            phone: row.phone ?? null,
            phoneSecondary: row.phoneSecondary ?? null,
            address: row.address ?? null,
          },
          select: { id: true, phone: true, address: true },
        });
        guardiansCreated += 1;
      }

      const existing = await tx.studentGuardian.findFirst({
        where: { studentId: student.id, guardianId: guardian.id },
        select: { id: true },
      });
      if (existing) {
        skipped.push({ line: row.line, reason: "déjà rattaché à cet élève" });
        continue;
      }

      const count = await tx.studentGuardian.count({ where: { studentId: student.id } });
      if (count >= MAX_GUARDIANS_PER_STUDENT) {
        skipped.push({ line: row.line, reason: "l'élève a déjà deux responsables" });
        continue;
      }

      const isPrimary = row.isPrimary ?? count === 0;
      if (isPrimary) {
        await tx.studentGuardian.updateMany({ where: { studentId: student.id }, data: { isPrimary: false } });
      }
      await tx.studentGuardian.create({
        data: {
          schoolId,
          studentId: student.id,
          guardianId: guardian.id,
          relationship: row.relationship ?? null,
          isPrimary,
        },
      });
      links += 1;
    }

    return { guardiansCreated, guardiansReused, links, skipped: skipped.slice(0, 200) };
  }

  async cancel(auth: AuthContext, jobId: string, client: ClientInfo) {
    const context = toTenantContext(auth);

    const updated = await this.tenancy.run(context, (tx) =>
      tx.importJob.updateMany({
        where: { id: jobId, status: "preview" },
        data: { status: "cancelled" },
      }),
    );

    if (updated.count === 0) {
      throw new NotFoundException("Import introuvable ou déjà traité.");
    }

    await this.audit.scoped(context, {
      action: "import.cancelled",
      entity: "ImportJob",
      entityId: jobId,
      severity: "warning",
      ip: client.ip,
      userAgent: client.userAgent,
    });

    return { ok: true };
  }
}
