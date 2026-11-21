import { ForbiddenException, Injectable } from "@nestjs/common";
import type { ConsentChannel, ConsentPurpose } from "@prisma/client";
import type { AuthContext } from "../auth/auth.types";
import { toTenantContext } from "../auth/auth.types";
import { schoolYearForDate } from "../core/school-year";
import { TenancyService } from "../core/tenancy.service";
import { addTextCounts, purposeStatus, type ConsentStudentStatus } from "./consent-status";

/** Plafond d'eleves renvoyes par l'apercu (une ecole pilote en compte quelques centaines). */
export const CONSENT_OVERVIEW_MAX_STUDENTS = 2000;

const PURPOSES: ConsentPurpose[] = ["student_account", "transport_alerts"];
const LOCALES = ["fr", "ar"] as const;

export type { ConsentStudentStatus };

type TextRow = {
  id: string;
  purpose: ConsentPurpose;
  /** null : texte brouillon invisible pour la direction (policy consent_text_read). */
  version: string | null;
  locale: string | null;
  status: "draft" | "validated";
  legalDraft: boolean;
  effectiveAt: Date | null;
  retiredAt: Date | null;
  accepted: number;
  withdrawn: number;
};

type RecordView = {
  id: string;
  purpose: ConsentPurpose;
  channel: ConsentChannel;
  grantedAt: Date;
  revokedAt: Date | null;
  guardian: string | null;
  paperDate: Date | null;
  paperFileReference: string | null;
  hasScan: boolean;
  textId: string;
};

/**
 * Ecran direction « Consentements » : apercu en LECTURE SEULE des consentements
 * parentaux de l'ecole du jeton.
 *
 * - Contexte RLS de l'appelant (tenancy.run) : ParentalConsent, Student, Guardian
 *   sont filtres par app.school_id ; aucune autre ecole n'est lisible.
 * - Textes : la policy consent_text_read ne laisse lire a la direction que les textes
 *   VALIDES. Un texte reference mais invisible est donc necessairement un brouillon :
 *   il est signale comme tel (« Brouillon juridique »), sans version ni contenu.
 * - Donnees : nom de l'eleve, code, classe, nom du responsable (deja visibles par la
 *   direction). Jamais d'e-mail, de telephone, d'IP ni d'user-agent.
 * - Aucun refus explicite n'existe dans le modele : un eleve sans consentement est
 *   « en attente », un eleve dont tous les consentements sont retires est « retire ».
 */
@Injectable()
export class ConsentOverviewService {
  constructor(private readonly tenancy: TenancyService) {}

  async overview(auth: AuthContext) {
    if (auth.role !== "direction" || !auth.schoolId) throw new ForbiddenException();
    const schoolId = auth.schoolId;
    const schoolYear = schoolYearForDate(new Date());

    const { students, texts, classrooms } = await this.tenancy.run(toTenantContext(auth), async (tx) => {
      const students = await tx.student.findMany({
        where: { schoolId },
        orderBy: [{ displayName: "asc" }],
        take: CONSENT_OVERVIEW_MAX_STUDENTS + 1,
        select: {
          id: true,
          displayName: true,
          studentCode: true,
          accountStatus: true,
          enrollments: { where: { schoolYear }, select: { classroom: { select: { id: true, name: true } } } },
          parentalConsents: {
            where: { schoolId },
            orderBy: { grantedAt: "desc" },
            select: {
              id: true,
              purpose: true,
              channel: true,
              grantedAt: true,
              revokedAt: true,
              guardianName: true,
              paperDate: true,
              paperFileReference: true,
              paperFileId: true,
              textId: true,
              guardian: { select: { fullName: true } },
            },
          },
        },
      });
      const texts = await tx.consentText.findMany({
        orderBy: [{ purpose: "asc" }, { locale: "asc" }, { effectiveAt: "desc" }],
        select: { id: true, purpose: true, version: true, locale: true, status: true, effectiveAt: true, retiredAt: true },
      });
      const classrooms = await tx.classroom.findMany({
        where: { schoolId },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      });
      return { students, texts, classrooms };
    });

    const truncated = students.length > CONSENT_OVERVIEW_MAX_STUDENTS;
    const kept = truncated ? students.slice(0, CONSENT_OVERVIEW_MAX_STUDENTS) : students;
    const visible = new Map(texts.map((t) => [t.id, t]));

    const textCounts = new Map<string, { accepted: number; withdrawn: number }>();
    const purposeCounts = new Map<ConsentPurpose, Record<ConsentStudentStatus, number>>(
      PURPOSES.map((p) => [p, { accepted: 0, withdrawn: 0, pending: 0 }]),
    );

    const rows = kept.map((student) => {
      const records: RecordView[] = student.parentalConsents.map((c) => ({
        id: c.id,
        purpose: c.purpose,
        channel: c.channel,
        grantedAt: c.grantedAt,
        revokedAt: c.revokedAt,
        guardian: c.channel === "paper_school" ? c.guardianName : c.guardian?.fullName ?? c.guardianName ?? null,
        paperDate: c.paperDate,
        paperFileReference: c.paperFileReference,
        hasScan: c.paperFileId !== null,
        textId: c.textId,
      }));
      addTextCounts(textCounts, records);
      const byPurpose = Object.fromEntries(
        PURPOSES.map((purpose) => {
          const { status, latestId } = purposeStatus(records, purpose);
          purposeCounts.get(purpose)![status] += 1;
          return [purpose, { status, latestId }];
        }),
      ) as Record<ConsentPurpose, { status: ConsentStudentStatus; latestId: string | null }>;
      return {
        id: student.id,
        displayName: student.displayName,
        studentCode: student.studentCode,
        accountStatus: student.accountStatus,
        classroom: student.enrollments[0]?.classroom ?? null,
        purposes: byPurpose,
        records,
      };
    });

    // Textes : versions validees visibles + references invisibles (= brouillons juridiques).
    const textRows: TextRow[] = texts.map((t) => ({
      id: t.id,
      purpose: t.purpose,
      version: t.version,
      locale: t.locale,
      status: t.status,
      legalDraft: t.status !== "validated",
      effectiveAt: t.effectiveAt,
      retiredAt: t.retiredAt,
      accepted: textCounts.get(t.id)?.accepted ?? 0,
      withdrawn: textCounts.get(t.id)?.withdrawn ?? 0,
    }));
    for (const [textId, counts] of textCounts) {
      if (visible.has(textId)) continue;
      const purpose = rows.flatMap((r) => r.records).find((r) => r.textId === textId)?.purpose ?? "student_account";
      textRows.push({
        id: textId,
        purpose,
        version: null,
        locale: null,
        status: "draft",
        legalDraft: true,
        effectiveAt: null,
        retiredAt: null,
        accepted: counts.accepted,
        withdrawn: counts.withdrawn,
      });
    }

    const current = PURPOSES.flatMap((purpose) =>
      LOCALES.map((locale) => {
        const t = texts.find((x) => x.purpose === purpose && x.locale === locale && x.status === "validated" && !x.retiredAt);
        return { purpose, locale, textId: t?.id ?? null, version: t?.version ?? null, legalDraft: !t };
      }),
    );

    return {
      schoolYear,
      truncated,
      classrooms,
      texts: textRows,
      current,
      purposes: PURPOSES.map((purpose) => ({ purpose, ...purposeCounts.get(purpose)!, refused: null })),
      students: rows,
    };
  }
}
