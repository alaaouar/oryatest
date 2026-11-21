import { describe, expect, it } from "vitest";
import { isReminderWindow, reminderLink, studentNoticeTitle } from "../../src/attendance/attendance-rules";
import { localParts } from "../../src/core/calendar-rules";

describe("rappel d'appel 7h45 et information eleve (CDC M3)", () => {
  it("fenetre 7h45 incluse - 12h00 exclue, en heure locale", () => {
    expect(isReminderWindow(7 * 60 + 44)).toBe(false);
    expect(isReminderWindow(7 * 60 + 45)).toBe(true);
    expect(isReminderWindow(11 * 60 + 59)).toBe(true);
    expect(isReminderWindow(12 * 60)).toBe(false);
  });
  it("depend du fuseau de l'ecole", () => {
    const at = new Date("2026-11-16T07:00:00.000Z");
    expect(isReminderWindow(localParts(at, "UTC").minutes)).toBe(false);
    expect(isReminderWindow(localParts(at, "Asia/Dubai").minutes)).toBe(true);
  });
  it("lien unique par classe et par jour (cle anti-doublon)", () => {
    expect(reminderLink("c1", "2026-11-16")).toBe("/attendance?classe=c1&date=2026-11-16");
    expect(reminderLink("c1", "2026-11-16")).not.toBe(reminderLink("c1", "2026-11-17"));
  });
  it("intitule de l'information eleve", () => {
    const d = new Date("2026-11-19T00:00:00.000Z");
    expect(studentNoticeTitle("absent", d, "morning")).toBe("Absence enregistrée le 19/11/2026 (matin)");
    expect(studentNoticeTitle("late", d, "afternoon")).toBe("Retard enregistré le 19/11/2026 (après-midi)");
  });
});
