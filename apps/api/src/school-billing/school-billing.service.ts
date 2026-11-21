import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Prisma, type SchoolBillingStatus, type SubscriptionStatus } from "@prisma/client";
import type { AuthContext } from "../auth/auth.types";
import type { ClientInfo } from "../auth/auth.service";
import { TenancyService, type TenantContext } from "../core/tenancy.service";
import {
  csvCell,
  deriveStatus,
  dueDateFor,
  formatMad,
  invoiceNumber,
  isActiveAt,
  isoDay,
  issuerFromEnv,
  issuerIsFictitious,
  ledger,
  referenceDateFor,
  schoolYearBounds,
  totals,
  ttcOf,
  type Issuer,
} from "./billing-rules";
import type { ComplementaryDto, CreditNoteDto, CsvQueryDto, EnrollmentDatesDto, EvaluateDto, IssueAnnualDto, PaymentDto, SchoolYearQueryDto, UpsertContractDto } from "./school-billing.dto";
import { renderInvoicePdf } from "./invoice-pdf";

type Tx = Prisma.TransactionClient;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CONTRACT_SELECT = {
  id: true, schoolId: true, reference: true, unitPriceHtMinor: true, vatRateBp: true, unitPriceTtcMinor: true, currency: true,
  status: true, trialEndsOn: true, paymentTermDays: true, noticeDays: true, referenceMonthDay: true, statusChangedAt: true,
} satisfies Prisma.SchoolContractSelect;

const DOC_SELECT = {
  id: true, schoolId: true, kind: true, number: true, schoolYear: true, referenceDate: true, issuedAt: true, dueDate: true,
  quantity: true, unitPriceHtMinor: true, vatRateBp: true, totalHtMinor: true, totalVatMinor: true, totalTtcMinor: true,
  currency: true, relatedInvoiceId: true, reason: true,
} satisfies Prisma.SchoolInvoiceSelect;

const PAYMENT_SELECT = { id: true, invoiceId: true, amountMinor: true, receivedOn: true, bankReference: true, note: true, createdAt: true } satisfies Prisma.SchoolPaymentSelect;

function civil(value: string, label: string): Date {
  const d = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || isoDay(d) !== value) throw new BadRequestException(`${label} invalide.`);
  return d;
}

/**
 * Bloc 5 (Avenant n 1) : facturation ecole. L'ecole collecte 120 DH TTC par enfant et par an et
 * effectue UN virement a ORYA ; aucun paiement parent en ligne, aucun PSP.
 * Ecritures : super-admin + MFA (guards), auditees DANS la meme transaction que l'action.
 * Lecture direction : son seul etablissement (RLS).
 */
@Injectable()
export class SchoolBillingService {
  private readonly logger = new Logger(SchoolBillingService.name);

  constructor(private readonly tenancy: TenancyService) {}

  private superContext(auth: AuthContext): TenantContext {
    return { userId: auth.userId, profileId: auth.profileId, schoolId: null, isSuperAdmin: true };
  }

  private schoolContext(auth: AuthContext): TenantContext {
    if (!auth.schoolId) throw new NotFoundException("Aucun etablissement actif.");
    return { userId: auth.userId, profileId: auth.profileId, schoolId: auth.schoolId, isSuperAdmin: false };
  }

  private requireUuid(id: string, label: string) {
    if (!UUID.test(id)) throw new NotFoundException(`${label} introuvable.`);
  }

  private async audit(tx: Tx, actorId: string | null, schoolId: string | null, action: string, entityId: string | null, metadata: Record<string, unknown>, severity: "info" | "warning" | "critical", client?: ClientInfo) {
    await tx.auditLog.create({
      data: { actorId, schoolId, action, entity: "SchoolBilling", entityId, severity, metadata: metadata as Prisma.InputJsonValue, ip: client?.ip ?? null, userAgent: client?.userAgent ?? null },
    });
  }

  /** Identite legale ORYA ; en production, refus tant qu'une valeur fictive subsiste. */
  private issuer(): Issuer {
    const issuer = issuerFromEnv();
    if (process.env.NODE_ENV === "production" && issuerIsFictitious(issuer)) {
      throw new ConflictException("Identite legale ORYA non configuree (BILLING_ISSUER_*) : emission impossible en production.");
    }
    return issuer;
  }

  /**
   * Emission : nouvelle tentative si deux transactions creent le meme compteur en meme temps.
   * La transaction en echec est annulee en entier (numero compris) : aucun trou.
   * `annualExists` : Prisma peut signaler la violation d'unicite sans nommer la contrainte
   * (meta.target = null, observe en concurrence, t52u D2) ; on verifie alors, dans une NOUVELLE
   * transaction, si la facture annuelle existe deja -> 409 au lieu d'une 500.
   */
  private async withRetry<T>(work: () => Promise<T>, annualExists?: () => Promise<boolean>): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await work();
      } catch (error) {
        const code = error instanceof Prisma.PrismaClientKnownRequestError ? error.code : "";
        if (code) this.logger.warn(`Emission : erreur Prisma ${code} (tentative ${attempt}), transaction annulee`);
        const target = String((error as Prisma.PrismaClientKnownRequestError).meta?.target ?? "");
        if (code === "P2002" && (/annualKey/i.test(target) || (annualExists && (await annualExists())))) {
          throw new ConflictException("La facture annuelle de cette annee scolaire est deja emise (facture complementaire ou avoir).");
        }
        if (attempt < 4 && (code === "P2002" || code === "P2034")) {
          if (code === "P2034" || /series|year|InvoiceSequence|pkey/i.test(target)) continue;
        }
        throw error;
      }
    }
  }

  private async allocate(tx: Tx, series: "FA" | "AV", year: number): Promise<number> {
    const row = await tx.invoiceSequence.upsert({
      where: { series_year: { series, year } },
      create: { series, year, lastValue: 1 },
      update: { lastValue: { increment: 1 } },
      select: { lastValue: true },
    });
    return row.lastValue;
  }

  /** Eleves actifs a la date de reference (regle documentee dans billing-rules.ts / docs/facturation-ecoles.md). */
  private async countActive(tx: Tx, schoolId: string, schoolYear: string, reference: Date): Promise<string[]> {
    const rows = await tx.enrollment.findMany({ where: { schoolId, schoolYear }, select: { studentId: true, startsOn: true, endsOn: true } });
    return rows.filter((r) => isActiveAt(r, reference)).map((r) => r.studentId).sort();
  }

  private async loadLedger(tx: Tx, schoolId: string) {
    const [docs, payments] = await Promise.all([
      tx.schoolInvoice.findMany({ where: { schoolId }, orderBy: [{ issuedAt: "asc" }, { number: "asc" }], select: DOC_SELECT }),
      tx.schoolPayment.findMany({ where: { schoolId }, orderBy: [{ receivedOn: "asc" }, { createdAt: "asc" }], select: PAYMENT_SELECT }),
    ]);
    return { docs, payments, summary: ledger(docs, payments) };
  }

  /** Recalcule et applique le statut derive ; synchronise l'abonnement (lecture seule si suspendu). */
  private async refreshStatus(tx: Tx, schoolId: string, now: Date, actorId: string | null): Promise<{ from: SchoolBillingStatus; to: SchoolBillingStatus } | null> {
    const contract = await tx.schoolContract.findUnique({ where: { schoolId }, select: { id: true, status: true, noticeDays: true } });
    if (!contract) return null;
    const { docs, payments } = await this.loadLedger(tx, schoolId);
    const next = deriveStatus(docs, payments, contract.noticeDays, now) as SchoolBillingStatus;
    if (next === contract.status) return { from: contract.status, to: next };
    await tx.schoolContract.update({ where: { schoolId }, data: { status: next, statusChangedAt: new Date() }, select: { id: true } });
    const subscription = await this.syncSubscription(tx, schoolId, contract.status, next);
    await this.audit(tx, actorId, schoolId, "billing.status.changed", contract.id, { from: contract.status, to: next, asOf: isoDay(now), subscription }, next === "suspended" ? "critical" : "warning");
    return { from: contract.status, to: next };
  }

  private async syncSubscription(tx: Tx, schoolId: string, from: SchoolBillingStatus, to: SchoolBillingStatus) {
    const sub = await tx.subscription.findUnique({ where: { schoolId }, select: { status: true } });
    if (!sub) {
      // Lecture seule appliquee par l'intercepteur d'abonnement : la creer si l'ecole n'en a pas.
      if (to !== "suspended") return null;
      await tx.subscription.create({ data: { schoolId, status: "suspended", statusChangedAt: new Date() }, select: { id: true } });
      return { before: null, after: "suspended" };
    }
    if (sub.status === "cancelled" || sub.status === "exempt") return null;
    let target: SubscriptionStatus | null = null;
    if (to === "suspended") target = "suspended";
    else if (from === "suspended" && sub.status === "suspended") target = to === "overdue" ? "past_due" : "active";
    else if (to === "overdue" && (sub.status === "active" || sub.status === "trial")) target = "past_due";
    else if ((to === "paid" || to === "invoiced") && sub.status === "past_due") target = "active";
    else if (to === "paid" && sub.status === "trial") target = "active";
    if (!target || target === sub.status) return { status: sub.status };
    await tx.subscription.update({ where: { schoolId }, data: { status: target, statusChangedAt: new Date() }, select: { status: true } });
    return { before: sub.status, after: target };
  }

  // ---------------------------------------------------------------- super-admin
  async listContracts(auth: AuthContext) {
    return this.tenancy.run(this.superContext(auth), async (tx) => {
      const [schools, docs, payments] = await Promise.all([
        tx.school.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, city: true, code: true, schoolContract: { select: CONTRACT_SELECT } } }),
        tx.schoolInvoice.findMany({ select: { id: true, schoolId: true, kind: true, quantity: true, totalTtcMinor: true, dueDate: true, relatedInvoiceId: true } }),
        tx.schoolPayment.findMany({ select: { schoolId: true, invoiceId: true, amountMinor: true } }),
      ]);
      return {
        schools: schools.map((s) => {
          const l = ledger(docs.filter((d) => d.schoolId === s.id), payments.filter((p) => p.schoolId === s.id));
          return { id: s.id, name: s.name, city: s.city, code: s.code, contract: s.schoolContract, billedMinor: l.billedMinor, creditedMinor: l.creditedMinor, paidMinor: l.paidMinor, balanceMinor: l.balanceMinor, documents: docs.filter((d) => d.schoolId === s.id).length };
        }),
      };
    });
  }

  async schoolDetail(auth: AuthContext, schoolId: string) {
    this.requireUuid(schoolId, "Etablissement");
    return this.tenancy.run(this.superContext(auth), async (tx) => {
      const school = await tx.school.findUnique({ where: { id: schoolId }, select: { id: true, name: true, city: true, code: true, ice: true, schoolContract: { select: CONTRACT_SELECT } } });
      if (!school) throw new NotFoundException("Etablissement introuvable.");
      const { docs, payments, summary } = await this.loadLedger(tx, schoolId);
      return { school, documents: docs.map((d) => ({ ...d, outstandingMinor: summary.outstanding.get(d.id) ?? 0 })), payments, ledger: { ...summary, outstanding: undefined } };
    });
  }

  async upsertContract(auth: AuthContext, schoolId: string, dto: UpsertContractDto, client: ClientInfo) {
    this.requireUuid(schoolId, "Etablissement");
    return this.tenancy.run(this.superContext(auth), async (tx) => {
      const school = await tx.school.findUnique({ where: { id: schoolId }, select: { id: true, code: true } });
      if (!school) throw new NotFoundException("Etablissement introuvable.");
      const before = await tx.schoolContract.findUnique({ where: { schoolId }, select: CONTRACT_SELECT });
      const ht = dto.unitPriceHtMinor ?? before?.unitPriceHtMinor ?? 10_000;
      const vat = dto.vatRateBp ?? before?.vatRateBp ?? 2_000;
      const data = {
        unitPriceHtMinor: ht,
        vatRateBp: vat,
        unitPriceTtcMinor: ttcOf(ht, vat),
        ...(dto.trialEndsOn !== undefined ? { trialEndsOn: dto.trialEndsOn === null ? null : civil(dto.trialEndsOn, "Fin d'essai") } : {}),
        ...(dto.paymentTermDays !== undefined ? { paymentTermDays: dto.paymentTermDays } : {}),
        ...(dto.noticeDays !== undefined ? { noticeDays: dto.noticeDays } : {}),
        ...(dto.referenceMonthDay !== undefined ? { referenceMonthDay: dto.referenceMonthDay } : {}),
      };
      if (data.referenceMonthDay) {
        try { referenceDateFor("2026-2027", data.referenceMonthDay); } catch { throw new BadRequestException("Date de reference invalide (MM-JJ)."); }
      }
      const after = before
        ? await tx.schoolContract.update({ where: { schoolId }, data, select: CONTRACT_SELECT })
        : await tx.schoolContract.create({ data: { schoolId, reference: `CTR-${school.code}`, createdById: auth.userId, ...data }, select: CONTRACT_SELECT });
      await this.audit(tx, auth.userId, schoolId, before ? "billing.contract.updated" : "billing.contract.created", after.id, { before, after }, "warning", client);
      return after;
    });
  }

  async preview(auth: AuthContext, schoolId: string, query: SchoolYearQueryDto) {
    this.requireUuid(schoolId, "Etablissement");
    return this.tenancy.run(this.superContext(auth), async (tx) => {
      const contract = await tx.schoolContract.findUnique({ where: { schoolId }, select: CONTRACT_SELECT });
      if (!contract) throw new NotFoundException("Aucun contrat pour cet etablissement.");
      const reference = this.referenceFor(query, contract.referenceMonthDay);
      const counted = await this.countActive(tx, schoolId, query.schoolYear, reference);
      return { schoolYear: query.schoolYear, referenceDate: isoDay(reference), quantity: counted.length, ...totals(counted.length, contract.unitPriceHtMinor, contract.vatRateBp) };
    });
  }

  private referenceFor(query: SchoolYearQueryDto, monthDay: string): Date {
    let reference: Date;
    try {
      reference = query.referenceDate ? civil(query.referenceDate, "Date de reference") : referenceDateFor(query.schoolYear, monthDay);
      const { start, end } = schoolYearBounds(query.schoolYear);
      if (reference < start || reference > end) throw new BadRequestException("La date de reference doit appartenir a l'annee scolaire.");
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException("Annee scolaire ou date de reference invalide.");
    }
    return reference;
  }

  async issueAnnual(auth: AuthContext, schoolId: string, dto: IssueAnnualDto, client: ClientInfo) {
    this.requireUuid(schoolId, "Etablissement");
    const issuer = this.issuer();
    return this.withRetry(() =>
      this.tenancy.run(this.superContext(auth), async (tx) => {
        const contract = await tx.schoolContract.findUnique({ where: { schoolId }, select: CONTRACT_SELECT });
        if (!contract) throw new NotFoundException("Aucun contrat pour cet etablissement.");
        const school = await tx.school.findUniqueOrThrow({ where: { id: schoolId }, select: { name: true, city: true, ice: true, code: true } });
        const reference = this.referenceFor(dto, contract.referenceMonthDay);
        const annualKey = `${schoolId}:${dto.schoolYear}`;
        if (await tx.schoolInvoice.findUnique({ where: { annualKey }, select: { id: true } })) {
          throw new ConflictException("La facture annuelle de cette annee scolaire est deja emise (facture complementaire ou avoir).");
        }
        const counted = await this.countActive(tx, schoolId, dto.schoolYear, reference);
        if (counted.length === 0) throw new ConflictException("Aucun eleve actif a la date de reference : rien a facturer.");
        const now = new Date();
        const year = now.getUTCFullYear();
        const seq = await this.allocate(tx, "FA", year);
        const doc = await tx.schoolInvoice.create({
          data: {
            schoolId, contractId: contract.id, kind: "invoice", number: invoiceNumber("FA", year, seq), series: "FA", year, seq, annualKey,
            schoolYear: dto.schoolYear, referenceDate: reference, issuedAt: now, dueDate: dueDateFor(now, contract.trialEndsOn, contract.paymentTermDays),
            quantity: counted.length, unitPriceHtMinor: contract.unitPriceHtMinor, vatRateBp: contract.vatRateBp,
            ...totals(counted.length, contract.unitPriceHtMinor, contract.vatRateBp), currency: contract.currency,
            countedStudentIds: counted, issuer, client: { name: school.name, city: school.city, ice: school.ice, code: school.code }, createdById: auth.userId,
          },
          select: DOC_SELECT,
        });
        await this.audit(tx, auth.userId, schoolId, "billing.invoice.issued", doc.id, { number: doc.number, quantity: doc.quantity, totalTtcMinor: doc.totalTtcMinor, referenceDate: isoDay(reference) }, "warning", client);
        const status = await this.refreshStatus(tx, schoolId, now, auth.userId);
        return { invoice: doc, status: status?.to ?? null };
      }),
      () => this.tenancy.run(this.superContext(auth), async (tx) => Boolean(await tx.schoolInvoice.findUnique({ where: { annualKey: `${schoolId}:${dto.schoolYear}` }, select: { id: true } }))),
    );
  }

  private async annualOf(tx: Tx, invoiceId: string) {
    this.requireUuid(invoiceId, "Facture");
    const annual = await tx.schoolInvoice.findUnique({ where: { id: invoiceId }, select: { ...DOC_SELECT, contractId: true, countedStudentIds: true, issuer: true, client: true } });
    if (!annual) throw new NotFoundException("Facture introuvable.");
    if (annual.kind !== "invoice") throw new ConflictException("Un complement ou un avoir se rattache a la facture ANNUELLE.");
    return annual;
  }

  async issueComplementary(auth: AuthContext, invoiceId: string, dto: ComplementaryDto, client: ClientInfo) {
    this.issuer();
    return this.withRetry(() =>
      this.tenancy.run(this.superContext(auth), async (tx) => {
        const annual = await this.annualOf(tx, invoiceId);
        const countDate = civil(dto.countDate, "Date de comptage");
        const { end } = schoolYearBounds(annual.schoolYear);
        if (countDate <= annual.referenceDate || countDate > end) throw new BadRequestException("La date de comptage doit etre posterieure a la reference et dans l'annee scolaire.");
        const previous = await tx.schoolInvoice.findMany({ where: { relatedInvoiceId: annual.id, kind: "complementary" }, select: { countedStudentIds: true } });
        const billed = new Set<string>([...(annual.countedStudentIds as string[]), ...previous.flatMap((p) => p.countedStudentIds as string[])]);
        const counted = (await this.countActive(tx, annual.schoolId, annual.schoolYear, countDate)).filter((id) => !billed.has(id));
        if (counted.length === 0) throw new ConflictException("Aucun nouvel eleve actif depuis la facture annuelle : rien a facturer.");
        const contract = await tx.schoolContract.findUniqueOrThrow({ where: { id: annual.contractId }, select: { trialEndsOn: true, paymentTermDays: true } });
        const now = new Date();
        const year = now.getUTCFullYear();
        const seq = await this.allocate(tx, "FA", year);
        const doc = await tx.schoolInvoice.create({
          data: {
            schoolId: annual.schoolId, contractId: annual.contractId, kind: "complementary", number: invoiceNumber("FA", year, seq), series: "FA", year, seq,
            schoolYear: annual.schoolYear, referenceDate: countDate, issuedAt: now, dueDate: dueDateFor(now, contract.trialEndsOn, contract.paymentTermDays),
            quantity: counted.length, unitPriceHtMinor: annual.unitPriceHtMinor, vatRateBp: annual.vatRateBp,
            ...totals(counted.length, annual.unitPriceHtMinor, annual.vatRateBp), currency: annual.currency,
            relatedInvoiceId: annual.id, reason: dto.reason, countedStudentIds: counted, issuer: this.issuer(), client: annual.client as Prisma.InputJsonValue, createdById: auth.userId,
          },
          select: DOC_SELECT,
        });
        await this.audit(tx, auth.userId, annual.schoolId, "billing.complementary.issued", doc.id, { number: doc.number, related: annual.number, quantity: doc.quantity, countDate: dto.countDate }, "warning", client);
        const status = await this.refreshStatus(tx, annual.schoolId, now, auth.userId);
        return { invoice: doc, status: status?.to ?? null };
      }),
    );
  }

  async issueCreditNote(auth: AuthContext, invoiceId: string, dto: CreditNoteDto, client: ClientInfo) {
    this.issuer();
    return this.withRetry(() =>
      this.tenancy.run(this.superContext(auth), async (tx) => {
        const annual = await this.annualOf(tx, invoiceId);
        const related = await tx.schoolInvoice.findMany({ where: { relatedInvoiceId: annual.id }, select: { kind: true, quantity: true } });
        const net = annual.quantity + related.reduce((a, r) => a + (r.kind === "credit_note" ? -r.quantity : r.quantity), 0);
        if (dto.quantity > net) throw new ConflictException(`Avoir refuse : ${dto.quantity} eleve(s) demandes, ${net} facture(s) net(s) sur cette annee.`);
        const now = new Date();
        const year = now.getUTCFullYear();
        const seq = await this.allocate(tx, "AV", year);
        const doc = await tx.schoolInvoice.create({
          data: {
            schoolId: annual.schoolId, contractId: annual.contractId, kind: "credit_note", number: invoiceNumber("AV", year, seq), series: "AV", year, seq,
            schoolYear: annual.schoolYear, referenceDate: annual.referenceDate, issuedAt: now, dueDate: now,
            quantity: dto.quantity, unitPriceHtMinor: annual.unitPriceHtMinor, vatRateBp: annual.vatRateBp,
            ...totals(dto.quantity, annual.unitPriceHtMinor, annual.vatRateBp), currency: annual.currency,
            relatedInvoiceId: annual.id, reason: dto.reason, countedStudentIds: [], issuer: this.issuer(), client: annual.client as Prisma.InputJsonValue, createdById: auth.userId,
          },
          select: DOC_SELECT,
        });
        await this.audit(tx, auth.userId, annual.schoolId, "billing.credit_note.issued", doc.id, { number: doc.number, related: annual.number, quantity: doc.quantity, reason: dto.reason }, "warning", client);
        const status = await this.refreshStatus(tx, annual.schoolId, now, auth.userId);
        return { invoice: doc, status: status?.to ?? null };
      }),
    );
  }

  /** Rapprochement MANUEL d'un virement recu (super-admin + MFA), audite en "critical". */
  async recordPayment(auth: AuthContext, invoiceId: string, dto: PaymentDto, client: ClientInfo) {
    this.requireUuid(invoiceId, "Facture");
    const receivedOn = civil(dto.receivedOn, "Date de reception");
    if (receivedOn.getTime() > Date.now() + 86_400_000) throw new BadRequestException("Date de reception dans le futur.");
    return this.tenancy.run(this.superContext(auth), async (tx) => {
      const invoice = await tx.schoolInvoice.findUnique({ where: { id: invoiceId }, select: { id: true, schoolId: true, kind: true, number: true } });
      if (!invoice) throw new NotFoundException("Facture introuvable.");
      if (invoice.kind === "credit_note") throw new ConflictException("Un virement se rapproche d'une facture, pas d'un avoir.");
      const { summary } = await this.loadLedger(tx, invoice.schoolId);
      if (dto.amountMinor > summary.balanceMinor) {
        throw new ConflictException(`Montant superieur au solde du (${formatMad(Math.max(0, summary.balanceMinor))} MAD) : verifier le virement.`);
      }
      const payment = await tx.schoolPayment.create({
        data: { schoolId: invoice.schoolId, invoiceId, amountMinor: dto.amountMinor, receivedOn, bankReference: dto.bankReference, note: dto.note ?? null, recordedById: auth.userId },
        select: PAYMENT_SELECT,
      });
      await this.audit(tx, auth.userId, invoice.schoolId, "billing.payment.reconciled", payment.id, { invoice: invoice.number, amountMinor: dto.amountMinor, receivedOn: dto.receivedOn, bankReference: dto.bankReference }, "critical", client);
      const status = await this.refreshStatus(tx, invoice.schoolId, new Date(), auth.userId);
      return { payment, status: status?.to ?? null };
    });
  }

  private async evaluateIn(tx: Tx, now: Date, actorId: string | null) {
    const contracts = await tx.schoolContract.findMany({ select: { schoolId: true } });
    const changes: { schoolId: string; from: SchoolBillingStatus; to: SchoolBillingStatus }[] = [];
    for (const c of contracts) {
      const r = await this.refreshStatus(tx, c.schoolId, now, actorId);
      if (r && r.from !== r.to) changes.push({ schoolId: c.schoolId, ...r });
    }
    return changes;
  }

  /** Super-admin : evaluation des statuts ; `asOf` (date simulee) refusee en production. */
  async evaluate(auth: AuthContext, dto: EvaluateDto, client: ClientInfo) {
    if (dto.asOf && process.env.NODE_ENV === "production") throw new BadRequestException("Date simulee interdite en production.");
    const now = dto.asOf ? civil(dto.asOf, "asOf") : new Date();
    return this.tenancy.run(this.superContext(auth), async (tx) => {
      const changes = await this.evaluateIn(tx, now, auth.userId);
      await this.audit(tx, auth.userId, null, "billing.evaluate", null, { asOf: isoDay(now), simulated: Boolean(dto.asOf), changes }, "warning", client);
      return { asOf: isoDay(now), changes };
    });
  }

  /** Job quotidien (school-billing.job.ts) : statuts a la date du jour. */
  async evaluateAllDue(): Promise<{ changes: number }> {
    const changes = await this.tenancy.runSystem((tx) => this.evaluateIn(tx, new Date(), null));
    if (changes.length > 0) this.logger.log(`Facturation : ${changes.length} changement(s) de statut`);
    return { changes: changes.length };
  }

  async pdfForAdmin(auth: AuthContext, invoiceId: string) {
    return this.pdfIn(this.superContext(auth), invoiceId);
  }

  async pdfForSchool(auth: AuthContext, invoiceId: string) {
    return this.pdfIn(this.schoolContext(auth), invoiceId);
  }

  private async pdfIn(context: TenantContext, invoiceId: string) {
    this.requireUuid(invoiceId, "Facture");
    return this.tenancy.run(context, async (tx) => {
      const doc = await tx.schoolInvoice.findUnique({ where: { id: invoiceId }, select: { ...DOC_SELECT, issuer: true, client: true, related: { select: { number: true } } } });
      if (!doc) throw new NotFoundException("Facture introuvable.");
      return { content: renderInvoicePdf(doc, doc.related?.number ?? null), filename: `${doc.number}.pdf` };
    });
  }

  /** Export comptable CSV (separateur ";", montants "120,00", avoirs negatifs), audite. */
  async exportCsv(auth: AuthContext, query: CsvQueryDto, client: ClientInfo) {
    const from = query.from ? civil(query.from, "from") : null;
    const to = query.to ? civil(query.to, "to") : null;
    return this.tenancy.run(this.superContext(auth), async (tx) => {
      const docs = await tx.schoolInvoice.findMany({
        where: { issuedAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: new Date(to.getTime() + 86_400_000) } : {}) } },
        orderBy: [{ series: "asc" }, { year: "asc" }, { seq: "asc" }],
        select: { ...DOC_SELECT, client: true, related: { select: { number: true } }, payments: { select: { amountMinor: true } } },
      });
      const header = ["numero", "type", "date_emission", "echeance", "etablissement", "ice_client", "annee_scolaire", "date_reference", "quantite", "pu_ht", "total_ht", "tva_taux", "total_tva", "total_ttc", "devise", "document_lie", "encaisse"];
      const rows = docs.map((d) => {
        const c = (d.client ?? {}) as { name?: string; ice?: string | null };
        const sign = d.kind === "credit_note" ? -1 : 1;
        return [d.number, d.kind === "invoice" ? "facture" : d.kind === "complementary" ? "facture_complementaire" : "avoir", isoDay(d.issuedAt), isoDay(d.dueDate), c.name ?? "", c.ice ?? "", d.schoolYear, isoDay(d.referenceDate), d.quantity, formatMad(d.unitPriceHtMinor), formatMad(sign * d.totalHtMinor), (d.vatRateBp / 100).toFixed(2).replace(".", ","), formatMad(sign * d.totalVatMinor), formatMad(sign * d.totalTtcMinor), d.currency, d.related?.number ?? "", formatMad(d.payments.reduce((a, p) => a + p.amountMinor, 0))]
          .map(csvCell)
          .join(";");
      });
      await this.audit(tx, auth.userId, null, "billing.export.csv", null, { from: query.from ?? null, to: query.to ?? null, rows: rows.length }, "warning", client);
      const content = Buffer.from("\uFEFF" + [header.join(";"), ...rows].join("\r\n") + "\r\n", "utf8");
      return { content, filename: `orya-factures-${query.from ?? "debut"}-${query.to ?? "fin"}.csv` };
    });
  }

  // ---------------------------------------------------------------- direction
  async schoolView(auth: AuthContext) {
    return this.tenancy.run(this.schoolContext(auth), async (tx) => {
      const schoolId = auth.schoolId as string;
      const contract = await tx.schoolContract.findUnique({ where: { schoolId }, select: CONTRACT_SELECT });
      const { docs, payments, summary } = await this.loadLedger(tx, schoolId);
      const issuer = issuerFromEnv();
      return {
        contract,
        readOnly: contract?.status === "suspended",
        documents: docs.map((d) => ({ ...d, outstandingMinor: summary.outstanding.get(d.id) ?? 0 })),
        payments: payments.map((p) => ({ id: p.id, invoiceId: p.invoiceId, amountMinor: p.amountMinor, receivedOn: p.receivedOn, bankReference: p.bankReference })),
        ledger: { billedMinor: summary.billedMinor, creditedMinor: summary.creditedMinor, paidMinor: summary.paidMinor, balanceMinor: summary.balanceMinor },
        transfer: { beneficiary: issuer.name, bank: issuer.bank, rib: issuer.rib, note: "Un seul virement de l'etablissement a ORYA, reference = numero de facture. Aucun paiement en ligne des familles." },
      };
    });
  }

  /** Direction : dates d'entree / sortie (comptage facture), auditees. Bloque si l'ecole est suspendue. */
  async setEnrollmentDates(auth: AuthContext, studentId: string, dto: EnrollmentDatesDto, client: ClientInfo) {
    this.requireUuid(studentId, "Eleve");
    const startsOn = dto.startsOn === undefined ? undefined : dto.startsOn === null ? null : civil(dto.startsOn, "Date d'entree");
    const endsOn = dto.endsOn === undefined ? undefined : dto.endsOn === null ? null : civil(dto.endsOn, "Date de sortie");
    return this.tenancy.run(this.schoolContext(auth), async (tx) => {
      const enrollment = await tx.enrollment.findUnique({ where: { studentId_schoolYear: { studentId, schoolYear: dto.schoolYear } }, select: { id: true, schoolId: true, startsOn: true, endsOn: true } });
      if (!enrollment || enrollment.schoolId !== auth.schoolId) throw new NotFoundException("Inscription introuvable pour cette annee.");
      const s = startsOn === undefined ? enrollment.startsOn : startsOn;
      const e = endsOn === undefined ? enrollment.endsOn : endsOn;
      if (s && e && e <= s) throw new BadRequestException("La date de sortie doit suivre la date d'entree.");
      const updated = await tx.enrollment.update({ where: { id: enrollment.id }, data: { startsOn: s, endsOn: e }, select: { id: true, schoolYear: true, startsOn: true, endsOn: true } });
      await this.audit(tx, auth.userId, auth.schoolId, "enrollment.dates.updated", enrollment.id, { studentId, schoolYear: dto.schoolYear, before: { startsOn: enrollment.startsOn, endsOn: enrollment.endsOn }, after: { startsOn: s, endsOn: e } }, "info", client);
      return updated;
    });
  }
}