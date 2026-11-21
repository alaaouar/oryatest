import { ServiceUnavailableException } from "@nestjs/common";

/**
 * Lot 9 : abstraction de fournisseur de paiement. AUCUN fournisseur réel n'est
 * branché : le choix (CMI, Stripe, virement…) et son contrat relèvent d'Ayoub.
 */
export interface BillingProvider {
  readonly name: string;
  readonly configured: boolean;
  readonly label: string;
  collect(invoice: { id: string; amountMinor: number | null; currency: string }): Promise<{ providerRef: string }>;
}

export const BILLING_PROVIDER = Symbol("BILLING_PROVIDER");

export class NotConfiguredBillingProvider implements BillingProvider {
  readonly name = "none";
  readonly configured = false;
  readonly label = "Non configuré";

  async collect(): Promise<{ providerRef: string }> {
    throw new ServiceUnavailableException({
      statusCode: 503,
      code: "BILLING_PROVIDER_NOT_CONFIGURED",
      message: "Fournisseur de paiement non configuré : aucun encaissement possible (décision Ayoub requise).",
    });
  }
}
