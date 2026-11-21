import { describe, expect, it } from "vitest";
import { addTextCounts, purposeStatus, type ConsentRecordLike } from "../../src/consent/consent-status";

const rec = (id: string, purpose: ConsentRecordLike["purpose"], revoked: boolean, textId = "t1"): ConsentRecordLike => ({
  id,
  purpose,
  revokedAt: revoked ? new Date("2026-10-01T00:00:00Z") : null,
  textId,
});

describe("statut de consentement d'un eleve par finalite", () => {
  it("aucun consentement -> en attente", () => {
    expect(purposeStatus([], "student_account")).toEqual({ status: "pending", latestId: null });
    expect(purposeStatus([rec("a", "transport_alerts", false)], "student_account")).toEqual({ status: "pending", latestId: null });
  });

  it("un consentement actif -> accepte, meme apres des retraits plus recents", () => {
    // tri du plus recent au plus ancien
    const records = [rec("r2", "student_account", true), rec("r1", "student_account", false)];
    expect(purposeStatus(records, "student_account")).toEqual({ status: "accepted", latestId: "r1" });
  });

  it("uniquement des retraits -> retire, dernier = le plus recent", () => {
    const records = [rec("r3", "student_account", true), rec("r2", "student_account", true)];
    expect(purposeStatus(records, "student_account")).toEqual({ status: "withdrawn", latestId: "r3" });
  });

  it("finalites independantes", () => {
    const records = [rec("s", "student_account", false), rec("t", "transport_alerts", true)];
    expect(purposeStatus(records, "student_account").status).toBe("accepted");
    expect(purposeStatus(records, "transport_alerts").status).toBe("withdrawn");
  });

  it("compteurs par texte : acceptations en cours et retraits, cumul sur plusieurs eleves", () => {
    const counts = new Map<string, { accepted: number; withdrawn: number }>();
    addTextCounts(counts, [rec("1", "student_account", false, "tA"), rec("2", "student_account", true, "tA")]);
    addTextCounts(counts, [rec("3", "student_account", false, "tA"), rec("4", "transport_alerts", false, "tB")]);
    expect(Object.fromEntries(counts)).toEqual({ tA: { accepted: 2, withdrawn: 1 }, tB: { accepted: 1, withdrawn: 0 } });
  });
});