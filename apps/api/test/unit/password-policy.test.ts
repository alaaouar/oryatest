import { describe, expect, it } from "vitest";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, passwordPolicyProblems } from "../../src/auth/password-policy";

const ctx = { email: "fatima.zahra@ecole-a.orya.test", current: "Ancien-Mdp-2026!" };

describe("politique de mot de passe (ebe40ca)", () => {
  it("accepte un mot de passe long, 3 familles, sans e-mail ni mot trivial", () => {
    expect(passwordPolicyProblems("Vert-Olivier-42-Sable", ctx)).toEqual([]);
  });

  it("borne la longueur a [12, 128]", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(12);
    expect(PASSWORD_MAX_LENGTH).toBe(128);
    expect(passwordPolicyProblems("Ab1-Ab1-Ab1", ctx).join(" ")).toMatch(/entre 12 et 128/); // 11
    expect(passwordPolicyProblems("Ab1-Ab1-Ab1x", ctx)).toEqual([]); // 12
    expect(passwordPolicyProblems("Ab1-" + "x".repeat(124), ctx)).toEqual([]); // 128
    expect(passwordPolicyProblems("Ab1-" + "x".repeat(125), ctx).join(" ")).toMatch(/entre 12 et 128/); // 129
  });

  it("exige au moins 3 familles", () => {
    expect(passwordPolicyProblems("toutenminuscule", ctx).join(" ")).toMatch(/3 familles/);
    expect(passwordPolicyProblems("minusculesMAJUSCULES", ctx).join(" ")).toMatch(/3 familles/);
    expect(passwordPolicyProblems("minusculesMAJUSCULES7", ctx)).toEqual([]);
    expect(passwordPolicyProblems("minuscules-et-symboles9", ctx)).toEqual([]);
  });

  it("refuse le mot de passe actuel", () => {
    expect(passwordPolicyProblems(ctx.current, ctx).join(" ")).toMatch(/different de l'actuel/);
  });

  it("refuse la partie locale de l'e-mail (4 caracteres ou plus), sans tenir compte de la casse", () => {
    expect(passwordPolicyProblems("XX-FATIMA.ZAHRA-99", ctx).join(" ")).toMatch(/adresse e-mail/);
    const short = { email: "ali@ecole.test", current: "x" };
    expect(passwordPolicyProblems("Ali-Mot-De-Passe-7", short)).toEqual([]);
  });

  it("refuse un mot trivial suivi seulement de chiffres ou symboles", () => {
    expect(passwordPolicyProblems("Azerty2026!!", ctx).join(" ")).toMatch(/trop courant/);
    expect(passwordPolicyProblems("Motdepasse-123", ctx).join(" ")).toMatch(/trop courant/);
    expect(passwordPolicyProblems("Azerty-Bleu-2026", ctx)).toEqual([]);
  });

  it("cumule les problemes et n'inclut jamais le mot de passe dans les messages", () => {
    const candidate = "azerty";
    const problems = passwordPolicyProblems(candidate, ctx);
    expect(problems.length).toBeGreaterThanOrEqual(3);
    for (const p of problems) expect(p).not.toContain(candidate);
  });
});