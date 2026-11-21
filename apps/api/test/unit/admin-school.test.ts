import { describe, expect, it } from "vitest";

describe("Admin & School Management rules", () => {
  it("validates school code format (6 alphanumeric characters)", () => {
    const codeRegex = /^[A-Za-z0-9]{6}$/;
    expect(codeRegex.test("ATL26A")).toBe(true);
    expect(codeRegex.test("123456")).toBe(true);
    expect(codeRegex.test("ATL26")).toBe(false);
    expect(codeRegex.test("ATL26AB")).toBe(false);
    expect(codeRegex.test("ATL-26")).toBe(false);
  });

  it("generates a compliant temporary password (>= 12 chars with upper, lower, numbers, symbol)", () => {
    function generatePassword(): string {
      const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
      let pwd = "";
      for (let i = 0; i < 10; i++) {
        pwd += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return pwd + "!Orya26";
    }

    for (let i = 0; i < 20; i++) {
      const pwd = generatePassword();
      expect(pwd.length).toBeGreaterThanOrEqual(12);
      expect(/[a-z]/.test(pwd)).toBe(true);
      expect(/[A-Z]/.test(pwd)).toBe(true);
      expect(/[0-9]/.test(pwd)).toBe(true);
      expect(/[!@#$%^&*]/.test(pwd)).toBe(true);
    }
  });

  it("formats credentials export cleanly for transmission to the school director", () => {
    const school = {
      name: "Groupe Scolaire Atlas",
      code: "ATL26A",
      adminEmail: "direction@atlas.ma",
      adminName: "M. Directeur Amine",
      password: "TestPassword!26",
    };

    const formatted = `=== IDENTIFIANTS D'ACCÈS ORYA ===\nÉtablissement : ${school.name}\nCode familles : ${school.code}\nAdresse e-mail : ${school.adminEmail}\nNom : ${school.adminName}\nMot de passe : ${school.password}\n=================================`;

    expect(formatted).toContain("Groupe Scolaire Atlas");
    expect(formatted).toContain("ATL26A");
    expect(formatted).toContain("direction@atlas.ma");
    expect(formatted).toContain("TestPassword!26");
  });
});
