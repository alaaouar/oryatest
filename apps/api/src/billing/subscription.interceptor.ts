import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from "@nestjs/common";
import { from, type Observable, switchMap } from "rxjs";
import { toTenantContext, type AuthContext } from "../auth/auth.types";
import { TenancyService } from "../core/tenancy.service";
import { PlanLimitsService } from "./plan-limits.service";

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Bloc 5 (t52u) : une suspension (ou une fin d'essai) met l'ecole en LECTURE SEULE, mais ne bloque
 * JAMAIS : la securite (auth/* : connexion, MFA, rafraichissement, deconnexion ; me/devices : revocation
 * de session ; me/password : changement de mot de passe, t62u A1), l'export des donnees (me/data-export), la suppression de compte (me/deletion par le
 * responsable, students/deletion par l'ecole), le retrait d'un consentement (parent ou ecole) et les
 * demandes de droits (me/data-rights). Liste fermee, ancree en fin de chemin ; tests BLOC5 S10-S19.
 */
const SUSPENSION_EXEMPT: readonly RegExp[] = [
  /\/(auth|me)(\/|$)/,
  /\/family\/children\/[^/]+\/consents\/[^/]+\/revoke\/?$/,
  /\/students\/[^/]+\/consents\/[^/]+\/revoke\/?$/,
  /\/students\/deletion\/?$/,
];

export function isSuspensionExempt(path: string): boolean {
  const clean = path.split("?")[0] ?? "";
  return SUSPENSION_EXEMPT.some((re) => re.test(clean));
}

/**
 * Lot 9 : un établissement suspendu, résilié, expiré ou en fin d'essai passe en
 * lecture seule pour tous ses rôles. Les routes d'authentification (connexion,
 * MFA, déconnexion, changement de profil) et le super-admin ne sont pas concernés.
 */
@Injectable()
export class SubscriptionStatusInterceptor implements NestInterceptor {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly limits: PlanLimitsService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{ method: string; path?: string; url?: string; auth?: AuthContext }>();
    const auth = request.auth;
    const path = request.path ?? request.url ?? "";
    if (READ_METHODS.has(request.method) || !auth || !auth.schoolId || auth.role === "super_admin" || isSuspensionExempt(path)) {
      return next.handle();
    }
    const schoolId = auth.schoolId;
    return from(this.tenancy.run(toTenantContext(auth), (tx) => this.limits.assertWritable(tx, schoolId))).pipe(switchMap(() => next.handle()));
  }
}
