import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req, Res, StreamableFile, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { CurrentAuth, RequireMfa, Roles } from "../auth/decorators";
import { JwtAuthGuard, MfaGuard, RolesGuard } from "../auth/guards";
import type { AuthContext } from "../auth/auth.types";
import { clientInfo } from "../common/client-info";
import { ComplementaryDto, CreditNoteDto, CsvQueryDto, EnrollmentDatesDto, EvaluateDto, IssueAnnualDto, PaymentDto, SchoolYearQueryDto, UpsertContractDto } from "./school-billing.dto";
import { SchoolBillingService } from "./school-billing.service";

function send(response: Response, content: Buffer, filename: string, type: string) {
  response.set({
    "Content-Type": type,
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Content-Length": String(content.length),
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Access-Control-Expose-Headers": "Content-Disposition",
  });
  return new StreamableFile(content);
}

/** Bloc 5 : facturation ecole cote ORYA (super-admin + MFA, chaque ecriture auditee). */
@Controller("admin/billing")
@UseGuards(JwtAuthGuard, RolesGuard, MfaGuard)
@Roles("super_admin")
@RequireMfa()
export class SchoolBillingAdminController {
  constructor(private readonly billing: SchoolBillingService) {}

  @Get("contracts")
  contracts(@CurrentAuth() auth: AuthContext) {
    return this.billing.listContracts(auth);
  }

  @Get("schools/:schoolId")
  school(@CurrentAuth() auth: AuthContext, @Param("schoolId") schoolId: string) {
    return this.billing.schoolDetail(auth, schoolId);
  }

  // PATCH (et non PUT) : CORS de l'API limite a GET/POST/PATCH/DELETE ; creation ou mise a jour du contrat.
  @Patch("schools/:schoolId/contract")
  contract(@CurrentAuth() auth: AuthContext, @Param("schoolId") schoolId: string, @Body() dto: UpsertContractDto, @Req() req: Request) {
    return this.billing.upsertContract(auth, schoolId, dto, clientInfo(req));
  }

  @Get("schools/:schoolId/preview")
  preview(@CurrentAuth() auth: AuthContext, @Param("schoolId") schoolId: string, @Query() query: SchoolYearQueryDto) {
    return this.billing.preview(auth, schoolId, query);
  }

  @Post("schools/:schoolId/invoices")
  @HttpCode(201)
  issue(@CurrentAuth() auth: AuthContext, @Param("schoolId") schoolId: string, @Body() dto: IssueAnnualDto, @Req() req: Request) {
    return this.billing.issueAnnual(auth, schoolId, dto, clientInfo(req));
  }

  @Post("invoices/:id/complementary")
  @HttpCode(201)
  complementary(@CurrentAuth() auth: AuthContext, @Param("id") id: string, @Body() dto: ComplementaryDto, @Req() req: Request) {
    return this.billing.issueComplementary(auth, id, dto, clientInfo(req));
  }

  @Post("invoices/:id/credit-notes")
  @HttpCode(201)
  creditNote(@CurrentAuth() auth: AuthContext, @Param("id") id: string, @Body() dto: CreditNoteDto, @Req() req: Request) {
    return this.billing.issueCreditNote(auth, id, dto, clientInfo(req));
  }

  @Post("invoices/:id/payments")
  @HttpCode(201)
  payment(@CurrentAuth() auth: AuthContext, @Param("id") id: string, @Body() dto: PaymentDto, @Req() req: Request) {
    return this.billing.recordPayment(auth, id, dto, clientInfo(req));
  }

  @Post("evaluate")
  @HttpCode(200)
  evaluate(@CurrentAuth() auth: AuthContext, @Body() dto: EvaluateDto, @Req() req: Request) {
    return this.billing.evaluate(auth, dto, clientInfo(req));
  }

  @Get("invoices/:id/pdf")
  async pdf(@CurrentAuth() auth: AuthContext, @Param("id") id: string, @Res({ passthrough: true }) response: Response) {
    const { content, filename } = await this.billing.pdfForAdmin(auth, id);
    return send(response, content, filename, "application/pdf");
  }

  @Get("export.csv")
  async csv(@CurrentAuth() auth: AuthContext, @Query() query: CsvQueryDto, @Req() req: Request, @Res({ passthrough: true }) response: Response) {
    const { content, filename } = await this.billing.exportCsv(auth, query, clientInfo(req));
    return send(response, content, filename, "text/csv; charset=utf-8");
  }
}

/** Bloc 5 : la direction consulte SON contrat, ses factures, ses virements et telecharge ses PDF. */
@Controller("billing/school")
@UseGuards(JwtAuthGuard, RolesGuard, MfaGuard)
@Roles("direction")
@RequireMfa()
export class SchoolBillingDirectionController {
  constructor(private readonly billing: SchoolBillingService) {}

  @Get()
  view(@CurrentAuth() auth: AuthContext) {
    return this.billing.schoolView(auth);
  }

  @Get("invoices/:id/pdf")
  async pdf(@CurrentAuth() auth: AuthContext, @Param("id") id: string, @Res({ passthrough: true }) response: Response) {
    const { content, filename } = await this.billing.pdfForSchool(auth, id);
    return send(response, content, filename, "application/pdf");
  }

  @Patch("enrollments/:studentId")
  enrollment(@CurrentAuth() auth: AuthContext, @Param("studentId") studentId: string, @Body() dto: EnrollmentDatesDto, @Req() req: Request) {
    return this.billing.setEnrollmentDates(auth, studentId, dto, clientInfo(req));
  }
}