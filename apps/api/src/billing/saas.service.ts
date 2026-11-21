import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { AuthContext } from "../auth/auth.types";
import type { ClientInfo } from "../auth/auth.service";
import { AuditService } from "../audit/audit.service";
import { TenancyService, type TenantContext } from "../core/tenancy.service";
import { BILLING_PROVIDER, type BillingProvider } from "./billing-provider";
import { PlanLimitsService, STAFF_ROLES } from "./plan-limits.service";
import type { CreatePlanDto, DraftInvoiceDto, ManagedStatus, UpdatePlanDto, UpdateSubscriptionDto } from "./saas.dto";

type Tx = Prisma.TransactionClient;
const DAY = 86_400_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Transitions autorisées (CDC lot 9). Résilié est terminal sauf réactivation explicite en « active ». */
const TRANSITIONS: Record<string, ManagedStatus[]> = {
  trial: ["active", "past_due", "suspended", "cancelled", "trial"],
  active: ["past_due", "suspended", "cancelled"],
  past_due: ["active", "suspended", "cancelled"],
  suspended: ["active", "cancelled"],
  cancelled: ["active"],
  expired: ["active", "trial", "cancelled"],
  exempt: ["active", "suspended", "cancelled"],
};

function civil(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

/**
 * Lot 9 : administration SaaS. Seul chemin inter-écoles : contexte super-admin
 * explicite (rôle super_admin + MFA, vérifiés par les guards), chaque lecture
 * détaillée d'une école et chaque écriture est journalisée. La RLS des rôles
 * d'école n'est pas modifiée.
 */
@Injectable()
export class SaasService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly audit: AuditService,
    private readonly limits: PlanLimitsService,
    @Inject(BILLING_PROVIDER) private readonly provider: BillingProvider,
  ) {}

  private superContext(auth: AuthContext): TenantContext {
    return { userId: auth.userId, profileId: auth.profileId, schoolId: null, isSuperAdmin: true };
  }

  private async log(context: TenantContext, client: ClientInfo, action: string, entity: string, entityId: string | null, metadata: Record<string, unknown>, severity: "info" | "warning" | "critical" = "info") {
    await this.audit.scoped(context, { action, entity, entityId, metadata, severity, ip: client.ip, userAgent: client.userAgent });
  }

  // ---- Tableau de bord plateforme ----
  async overview(auth: AuthContext, client: ClientInfo) {
    const context = this.superContext(auth);
    const since = new Date(Date.now() - 30 * DAY);
    const data = await this.tenancy.run(context, async (tx) => {
      const [schools, students, profiles, files, messages, sessions, activity, users] = await Promise.all([
        tx.school.findMany({
          orderBy: { createdAt: "desc" },
          select: {
            id: true, name: true, city: true, code: true, status: true, createdAt: true,
            subscription: { select: { status: true, trialEndsAt: true, currentPeriodEnd: true, planRef: { select: { code: true, name: true, maxStudents: true, maxStaff: true, toBeDefined: true } } } },
          },
        }),
        tx.student.groupBy({ by: ["schoolId"], _count: { _all: true } }),
        tx.userProfile.groupBy({ by: ["schoolId", "role"], where: { schoolId: { not: null } }, _count: { _all: true } }),
        tx.storedFile.groupBy({ by: ["schoolId"], _sum: { sizeBytes: true } }),
        tx.message.groupBy({ by: ["schoolId"], where: { createdAt: { gte: since } }, _count: { _all: true } }),
        tx.attendanceSession.groupBy({ by: ["schoolId"], where: { createdAt: { gte: since } }, _count: { _all: true } }),
        tx.auditLog.groupBy({ by: ["schoolId"], where: { schoolId: { not: null } }, _max: { createdAt: true } }),
        tx.user.count(),
      ]);
      return { schools, students, profiles, files, messages, sessions, activity, users };
    });
    const count = (list: { schoolId: string | null; _count: { _all: number } }[]) => new Map(list.map((e) => [e.schoolId, e._count._all]));
    const st = count(data.students);
    const ms = count(data.messages);
    const ss = count(data.sessions);
    const fs = new Map(data.files.map((e) => [e.schoolId, e._sum.sizeBytes ?? 0]));
    const act = new Map(data.activity.map((e) => [e.schoolId, e._max.createdAt]));
    const staff = new Map<string, number>();
    const parents = new Map<string, number>();
    for (const p of data.profiles) {
      if (!p.schoolId) continue;
      if ((STAFF_ROLES as readonly string[]).includes(p.role)) staff.set(p.schoolId, (staff.get(p.schoolId) ?? 0) + p._count._all);
      if (p.role === "parent") parents.set(p.schoolId, (parents.get(p.schoolId) ?? 0) + p._count._all);
    }
    const now = Date.now();
    const rows = data.schools.map((s) => ({
      id: s.id, name: s.name, city: s.city, code: s.code, status: s.status, createdAt: s.createdAt,
      subscription: s.subscription
        ? { status: s.subscription.status, trialEndsAt: s.subscription.trialEndsAt, currentPeriodEnd: s.subscription.currentPeriodEnd, plan: s.subscription.planRef }
        : null,
      usage: {
        students: st.get(s.id) ?? 0,
        staff: staff.get(s.id) ?? 0,
        parents: parents.get(s.id) ?? 0,
        messages30d: ms.get(s.id) ?? 0,
        sessions30d: ss.get(s.id) ?? 0,
        storageBytes: fs.get(s.id) ?? 0,
        lastActivityAt: act.get(s.id) ?? null,
      },
    }));
    const bySchoolStatus: Record<string, number> = {};
    const bySubscription: Record<string, number> = {};
    for (const r of rows) {
      bySchoolStatus[r.status] = (bySchoolStatus[r.status] ?? 0) + 1;
      const key = r.subscription?.status ?? "none";
      bySubscription[key] = (bySubscription[key] ?? 0) + 1;
    }
    await this.log(context, client, "platform.overview.viewed", "Platform", null, { schools: rows.length });
    return {
      totals: {
        schools: rows.length,
        users: data.users,
        students: rows.reduce((a, r) => a + r.usage.students, 0),
        staff: rows.reduce((a, r) => a + r.usage.staff, 0),
        parents: rows.reduce((a, r) => a + r.usage.parents, 0),
      },
      bySchoolStatus,
      bySubscription,
      trialsEndingSoon: rows.filter((r) => r.subscription?.status === "trial" && r.subscription.trialEndsAt && new Date(r.subscription.trialEndsAt).getTime() - now < 30 * DAY).map((r) => ({ id: r.id, name: r.name, trialEndsAt: r.subscription?.trialEndsAt })),
      schools: rows,
      billingProvider: { name: this.provider.name, configured: this.provider.configured, label: this.provider.label },
    };
  }

  private requireUuid(id: string, label = "Établissement") {
    if (!UUID.test(id)) throw new NotFoundException(`${label} introuvable.`);
  }

  private async usage(tx: Tx, schoolId: string) {
    const since = new Date(Date.now() - 30 * DAY);
    const [students, staff, parents, messages30d, sessions30d, storage] = await Promise.all([
      tx.student.count({ where: { schoolId } }),
      this.limits.staffCount(tx, schoolId),
      tx.userProfile.count({ where: { schoolId, role: "parent" } }),
      tx.message.count({ where: { schoolId, createdAt: { gte: since } } }),
      tx.attendanceSession.count({ where: { schoolId, createdAt: { gte: since } } }),
      tx.storedFile.aggregate({ where: { schoolId }, _sum: { sizeBytes: true } }),
    ]);
    return { students, staff, parents, messages30d, sessions30d, storageBytes: storage._sum.sizeBytes ?? 0 };
  }

  async school(auth: AuthContext, schoolId: string, client: ClientInfo) {
    this.requireUuid(schoolId);
    const context = this.superContext(auth);
    const result = await this.tenancy.run(context, async (tx) => {
      const school = await tx.school.findUnique({
        where: { id: schoolId },
        select: {
          id: true, name: true, city: true, code: true, status: true, createdAt: true,
          subscription: { select: { status: true, trialEndsAt: true, currentPeriodEnd: true, statusChangedAt: true, planRef: true } },
        },
      });
      if (!school) throw new NotFoundException("Établissement introuvable.");
      const [usage, invoices, snapshots] = await Promise.all([
        this.usage(tx, schoolId),
        tx.invoice.findMany({ where: { schoolId }, orderBy: { createdAt: "desc" }, take: 50 }),
        tx.usageSnapshot.findMany({ where: { schoolId }, orderBy: { takenAt: "desc" }, take: 30 }),
      ]);
      return { school, usage, invoices, snapshots };
    });
    await this.log(context, client, "school.inspected", "School", schoolId, {});
    return result;
  }

  // ---- Plans ----
  async listPlans(auth: AuthContext) {
    return this.tenancy.run(this.superContext(auth), async (tx) => {
      const plans = await tx.plan.findMany({ orderBy: { createdAt: "asc" }, include: { _count: { select: { subscriptions: true } } } });
      return plans.map(({ _count, ...plan }) => ({ ...plan, subscriptions: _count.subscriptions }));
    });
  }

  async createPlan(auth: AuthContext, dto: CreatePlanDto, client: ClientInfo) {
    const context = this.superContext(auth);
    const plan = await this.tenancy.run(context, async (tx) => {
      if (await tx.plan.findUnique({ where: { code: dto.code }, select: { id: true } })) throw new ConflictException("Un plan porte déjà ce code.");
      return tx.plan.create({
        data: { code: dto.code, name: dto.name, maxStudents: dto.maxStudents ?? null, maxStaff: dto.maxStaff ?? null, trialDays: dto.trialDays ?? null, priceMinor: dto.priceMinor ?? null, toBeDefined: dto.toBeDefined ?? true, notes: dto.notes ?? null },
      });
    });
    await this.log(context, client, "plan.created", "Plan", plan.id, { code: plan.code, maxStudents: plan.maxStudents, maxStaff: plan.maxStaff, priceMinor: plan.priceMinor }, "warning");
    return plan;
  }

  async updatePlan(auth: AuthContext, planId: string, dto: UpdatePlanDto, client: ClientInfo) {
    this.requireUuid(planId, "Plan");
    const context = this.superContext(auth);
    const { before, after } = await this.tenancy.run(context, async (tx) => {
      const before = await tx.plan.findUnique({ where: { id: planId } });
      if (!before) throw new NotFoundException("Plan introuvable.");
      const after = await tx.plan.update({ where: { id: planId }, data: { ...dto } });
      return { before, after };
    });
    const changed = Object.keys(dto).filter((k) => (before as Record<string, unknown>)[k] !== (after as Record<string, unknown>)[k]);
    await this.log(context, client, "plan.updated", "Plan", planId, { changed, before: Object.fromEntries(changed.map((k) => [k, (before as Record<string, unknown>)[k]])), after: Object.fromEntries(changed.map((k) => [k, (after as Record<string, unknown>)[k]])) }, "warning");
    return after;
  }

  // ---- Abonnement d'une école ----
  async updateSubscription(auth: AuthContext, schoolId: string, dto: UpdateSubscriptionDto, client: ClientInfo) {
    this.requireUuid(schoolId);
    const context = this.superContext(auth);
    if ((dto.status === "suspended" || dto.status === "cancelled") && !dto.reason) {
      throw new BadRequestException("Un motif est obligatoire pour suspendre ou résilier.");
    }
    const result = await this.tenancy.run(context, async (tx) => {
      const current = await tx.subscription.findUnique({ where: { schoolId } });
      if (!current) throw new NotFoundException("Établissement introuvable.");
      const data: Prisma.SubscriptionUncheckedUpdateInput = {};
      if (dto.planId !== undefined) {
        this.requireUuid(dto.planId, "Plan");
        const plan = await tx.plan.findUnique({ where: { id: dto.planId }, select: { id: true, isActive: true, maxStudents: true, maxStaff: true, trialDays: true } });
        if (!plan || !plan.isActive) throw new NotFoundException("Plan introuvable ou inactif.");
        data.planId = plan.id;
        if (plan.trialDays && current.status === "trial" && !dto.trialEndsAt) data.trialEndsAt = new Date(Date.now() + plan.trialDays * DAY);
      }
      if (dto.status && dto.status !== current.status) {
        if (!(TRANSITIONS[current.status] ?? []).includes(dto.status)) {
          throw new ConflictException(`Transition interdite : ${current.status} → ${dto.status}.`);
        }
        data.status = dto.status;
        data.statusChangedAt = new Date();
      }
      if (dto.trialEndsAt) data.trialEndsAt = civil(dto.trialEndsAt);
      if (dto.currentPeriodEnd) data.currentPeriodEnd = civil(dto.currentPeriodEnd);
      const updated = await tx.subscription.update({ where: { schoolId }, data, select: { status: true, trialEndsAt: true, currentPeriodEnd: true, statusChangedAt: true, planRef: { select: { id: true, code: true, name: true, maxStudents: true, maxStaff: true } } } });
      return { before: { status: current.status, planId: current.planId, trialEndsAt: current.trialEndsAt }, updated };
    });
    const severe = dto.status === "suspended" || dto.status === "cancelled";
    await this.log(context, client, "subscription.updated", "Subscription", schoolId, { before: result.before, after: { status: result.updated.status, planId: result.updated.planRef?.id ?? null, trialEndsAt: result.updated.trialEndsAt }, reason: dto.reason ?? null }, severe ? "critical" : "warning");
    return result.updated;
  }

  async snapshot(auth: AuthContext, schoolId: string, client: ClientInfo) {
    this.requireUuid(schoolId);
    const context = this.superContext(auth);
    const snap = await this.tenancy.run(context, async (tx) => {
      if (!(await tx.school.findUnique({ where: { id: schoolId }, select: { id: true } }))) throw new NotFoundException("Établissement introuvable.");
      const metrics = await this.usage(tx, schoolId);
      return tx.usageSnapshot.create({ data: { schoolId, metrics } });
    });
    await this.log(context, client, "usage.snapshot", "School", schoolId, { snapshotId: snap.id });
    return snap;
  }

  // ---- Préparation facturation (aucun paiement réel) ----
  async draftInvoice(auth: AuthContext, schoolId: string, dto: DraftInvoiceDto, client: ClientInfo) {
    this.requireUuid(schoolId);
    const start = civil(dto.periodStart);
    const end = civil(dto.periodEnd);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) throw new BadRequestException("Période de facturation invalide.");
    const context = this.superContext(auth);
    const invoice = await this.tenancy.run(context, async (tx) => {
      const sub = await tx.subscription.findUnique({ where: { schoolId }, select: { planRef: { select: { code: true, name: true, priceMinor: true, currency: true, toBeDefined: true } } } });
      if (!sub) throw new NotFoundException("Établissement introuvable.");
      const students = await tx.student.count({ where: { schoolId } });
      const unit = sub.planRef && !sub.planRef.toBeDefined ? sub.planRef.priceMinor : null;
      const lines = [{ label: `Abonnement ${sub.planRef?.name ?? "sans plan"}`, quantity: students, unit: "élève", unitPriceMinor: unit, amountMinor: unit === null ? null : unit * students, note: unit === null ? "Prix à définir par ORYA" : null }];
      return tx.invoice.create({
        data: { schoolId, periodStart: start, periodEnd: end, planCode: sub.planRef?.code ?? null, currency: sub.planRef?.currency ?? "MAD", amountMinor: unit === null ? null : unit * students, lines, provider: this.provider.name, createdById: auth.userId },
      });
    });
    await this.log(context, client, "invoice.drafted", "Invoice", invoice.id, { schoolId, amountMinor: invoice.amountMinor, planCode: invoice.planCode }, "warning");
    return invoice;
  }

  async collect(auth: AuthContext, invoiceId: string, client: ClientInfo) {
    this.requireUuid(invoiceId, "Facture");
    const context = this.superContext(auth);
    const invoice = await this.tenancy.run(context, (tx) => tx.invoice.findUnique({ where: { id: invoiceId } }));
    if (!invoice) throw new NotFoundException("Facture introuvable.");
    await this.log(context, client, "invoice.collect.attempted", "Invoice", invoiceId, { provider: this.provider.name, configured: this.provider.configured }, "warning");
    return this.provider.collect({ id: invoice.id, amountMinor: invoice.amountMinor, currency: invoice.currency });
  }

  providerStatus() {
    return { name: this.provider.name, configured: this.provider.configured, label: this.provider.label };
  }

  // ---- Vue direction (son établissement uniquement, contexte RLS de l'école) ----
  async schoolBilling(auth: AuthContext) {
    if (!auth.schoolId) throw new NotFoundException("Aucun établissement actif.");
    const schoolId = auth.schoolId;
    return this.tenancy.run({ userId: auth.userId, profileId: auth.profileId, schoolId, isSuperAdmin: false }, async (tx) => {
      const sub = await tx.subscription.findUnique({
        where: { schoolId },
        select: { status: true, trialEndsAt: true, currentPeriodEnd: true, planRef: { select: { code: true, name: true, maxStudents: true, maxStaff: true, toBeDefined: true } } },
      });
      const [usage, invoices] = await Promise.all([
        this.usage(tx, schoolId),
        tx.invoice.findMany({ where: { schoolId, status: { not: "void" } }, orderBy: { createdAt: "desc" }, take: 24, select: { id: true, status: true, periodStart: true, periodEnd: true, amountMinor: true, currency: true, planCode: true, createdAt: true } }),
      ]);
      return { subscription: sub, usage, invoices, billingProvider: this.providerStatus() };
    });
  }
}
