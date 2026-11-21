import { describe, expect, it } from "vitest";
import {
  type LedgerDoc,
  deriveStatus,
  dueDateFor,
  formatMad,
  isActiveAt,
  ledger,
  referenceDateFor,
  totals,
  ttcOf,
  vatOf,
} from "../../src/school-billing/billing-rules";

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe("montants de facturation ecole (Avenant : 100 DH HT / 120 TTC par enfant)", () => {
  it("TVA 20 % et TTC par enfant", () => {
    expect(vatOf(10_000, 2_000)).toBe(2_000);
    expect(ttcOf(10_000, 2_000)).toBe(12_000);
    expect(formatMad(ttcOf(10_000, 2_000))).toBe("120,00");
  });

  it("totaux pour une quantite : HT x quantite, TVA arrondie au centime sur le total", () => {
    expect(totals(250, 10_000, 2_000)).toEqual({ totalHtMinor: 2_500_000, totalVatMinor: 500_000, totalTtcMinor: 3_000_000 });
    // arrondi commercial : 0,5 centime -> superieur
    expect(vatOf(1_234, 1_250)).toBe(154); // 154.25
    expect(vatOf(1_236, 1_250)).toBe(155); // 154.5
    expect(totals(3, 333, 2_000)).toEqual({ totalHtMinor: 999, totalVatMinor: 200, totalTtcMinor: 1_199 });
    expect(totals(0, 10_000, 2_000).totalTtcMinor).toBe(0);
  });

  it("format MAD : centimes, signe, zero", () => {
    expect(formatMad(0)).toBe("0,00");
    expect(formatMad(5)).toBe("0,05");
    expect(formatMad(-12_345)).toBe("-123,45");
  });

  it("comptage a la date de reference (docs/facturation-ecoles.md)", () => {
    const ref = referenceDateFor("2026-2027", "10-31");
    expect(ref.toISOString().slice(0, 10)).toBe("2026-10-31");
    expect(referenceDateFor("2026-2027", "03-15").toISOString().slice(0, 10)).toBe("2027-03-15");
    expect(() => referenceDateFor("2026-2028", "10-31")).toThrow();
    expect(() => referenceDateFor("2026-2027", "02-30")).toThrow();
    expect(isActiveAt({ startsOn: null, endsOn: null }, ref)).toBe(true);
    expect(isActiveAt({ startsOn: d("2026-10-31"), endsOn: null }, ref)).toBe(true); // inscrit le jour J
    expect(isActiveAt({ startsOn: d("2026-11-01"), endsOn: null }, ref)).toBe(false); // apres J : complementaire
    expect(isActiveAt({ startsOn: null, endsOn: d("2026-10-31") }, ref)).toBe(false); // sorti le jour J
    expect(isActiveAt({ startsOn: null, endsOn: d("2026-11-01") }, ref)).toBe(true); // sorti apres J : du
  });

  it("echeance : fin d'essai si posterieure a l'emission, plus le delai", () => {
    expect(dueDateFor(d("2026-11-01"), null, 30).toISOString().slice(0, 10)).toBe("2026-12-01");
    expect(dueDateFor(d("2026-11-01"), d("2026-12-15"), 30).toISOString().slice(0, 10)).toBe("2027-01-14");
    expect(dueDateFor(d("2026-11-01"), d("2026-10-01"), 30).toISOString().slice(0, 10)).toBe("2026-12-01");
  });
});

describe("solde et statut derive", () => {
  const invoice: LedgerDoc = { id: "fa1", kind: "invoice", quantity: 10, totalTtcMinor: 120_000, dueDate: d("2026-12-01"), relatedInvoiceId: null };
  const credit: LedgerDoc = { id: "av1", kind: "credit_note", quantity: 2, totalTtcMinor: 24_000, dueDate: d("2026-12-01"), relatedInvoiceId: "fa1" };

  it("avoir impute sur la facture liee, paiements partiels", () => {
    const l = ledger([invoice, credit], [{ invoiceId: "fa1", amountMinor: 50_000 }]);
    expect(l).toMatchObject({ billedMinor: 120_000, creditedMinor: 24_000, paidMinor: 50_000, balanceMinor: 46_000, billedQuantity: 8 });
    expect(l.outstanding.get("fa1")).toBe(46_000);
    expect(l.outstanding.has("av1")).toBe(false);
  });

  it("essai, facture, en retard, suspendu, paye", () => {
    const notice = 15;
    expect(deriveStatus([], [], notice, d("2026-11-15"))).toBe("trial");
    expect(deriveStatus([credit], [], notice, d("2026-11-15"))).toBe("trial");
    expect(deriveStatus([invoice], [], notice, d("2026-12-01"))).toBe("invoiced");
    expect(deriveStatus([invoice], [], notice, d("2026-12-02"))).toBe("overdue");
    expect(deriveStatus([invoice], [], notice, d("2026-12-16"))).toBe("overdue");
    expect(deriveStatus([invoice], [], notice, d("2026-12-17"))).toBe("suspended");
    expect(deriveStatus([invoice, credit], [{ invoiceId: "fa1", amountMinor: 96_000 }], notice, d("2027-06-01"))).toBe("paid");
  });
});