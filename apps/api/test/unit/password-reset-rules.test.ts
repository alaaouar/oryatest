import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  RESET_REQUEST_RESPONSE,
  formatResetToken,
  parseResetToken,
  resetAccountLimit,
  resetLink,
  resetTokenStatus,
  resetTtlMinutes,
} from "../../src/auth/password-reset.rules";
import { DisabledMailer, MailerNotConfiguredError, OutboxFileMailer, createMailer } from "../../src/mail/mailer";

const UID = "0b9f3c1e-6c2a-4d7e-9a51-3f7c2b8d4e10";
const SECRET = "A".repeat(43);

describe("jeton de reinitialisation (F01)", () => {
  it("format r1.<uuid>.<secret> aller-retour", () => {
    const token = formatResetToken(UID, SECRET);
    expect(token).toBe(`r1.${UID}.${SECRET}`);
    expect(parseResetToken(token)).toEqual({ userId: UID });
    expect(parseResetToken(`  ${token}  `)).toEqual({ userId: UID });
  });

  it("refuse les jetons malformes", () => {
    for (const bad of [undefined, null, 42, "", `r2.${UID}.${SECRET}`, `r1.${UID.toUpperCase()}.${SECRET}`, `r1.pas-un-uuid.${SECRET}`, `r1.${UID}.court`, `r1.${UID}.${"A".repeat(65)}`, `r1.${UID}.${"A".repeat(42)}=`]) {
      expect(parseResetToken(bad)).toBeNull();
    }
  });

  it("statut : inconnu, utilise, expire (borne incluse), valide", () => {
    const now = new Date("2026-11-15T10:00:00Z");
    expect(resetTokenStatus(null, now)).toBe("unknown");
    expect(resetTokenStatus(undefined, now)).toBe("unknown");
    expect(resetTokenStatus({ usedAt: new Date("2026-11-15T09:59:00Z"), expiresAt: new Date("2026-11-15T10:30:00Z") }, now)).toBe("used");
    expect(resetTokenStatus({ usedAt: null, expiresAt: now }, now)).toBe("expired");
    expect(resetTokenStatus({ usedAt: null, expiresAt: new Date(now.getTime() + 1) }, now)).toBe("valid");
  });

  it("duree bornee [5, 60], defaut 30 ; plafond par compte borne [1, 20], defaut 3", () => {
    expect(resetTtlMinutes(undefined)).toBe(30);
    expect(resetTtlMinutes("4")).toBe(30);
    expect(resetTtlMinutes("5")).toBe(5);
    expect(resetTtlMinutes("60")).toBe(60);
    expect(resetTtlMinutes("61")).toBe(30);
    expect(resetTtlMinutes("12.5")).toBe(30);
    expect(resetAccountLimit(undefined)).toBe(3);
    expect(resetAccountLimit("0")).toBe(3);
    expect(resetAccountLimit("1")).toBe(1);
    expect(resetAccountLimit("20")).toBe(20);
    expect(resetAccountLimit("21")).toBe(3);
  });

  it("lien : jeton dans le fragment, origine sans barre finale", () => {
    const link = resetLink("https://console.orya.ma///", formatResetToken(UID, SECRET));
    expect(link).toBe(`https://console.orya.ma/nouveau-mot-de-passe#token=r1.${UID}.${SECRET}`);
    expect(new URL(link).search).toBe("");
  });

  it("reponse de demande unique, sans indice sur l'existence du compte", () => {
    expect(RESET_REQUEST_RESPONSE.ok).toBe(true);
    expect(RESET_REQUEST_RESPONSE.message).toMatch(/^Si un compte actif correspond/);
  });
});

describe("mailer agnostique (F01)", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("production : DisabledMailer, envoi refuse, boite locale ignoree", async () => {
    const m = createMailer({ NODE_ENV: "production", MAIL_OUTBOX_DIR: join(tmpdir(), "ne-doit-pas-servir") } as NodeJS.ProcessEnv);
    expect(m).toBeInstanceOf(DisabledMailer);
    expect(m.configured).toBe(false);
    await expect(m.send({ to: "a@b.c", subject: "s", text: "t", kind: "k" })).rejects.toBeInstanceOf(MailerNotConfiguredError);
  });

  it("hors production : boite d'envoi locale, un fichier JSON par message", async () => {
    const dir = mkdtempSync(join(tmpdir(), "orya-unit-outbox-"));
    dirs.push(dir);
    const m = createMailer({ NODE_ENV: "development", MAIL_OUTBOX_DIR: dir } as NodeJS.ProcessEnv);
    expect(m).toBeInstanceOf(OutboxFileMailer);
    expect(m.configured).toBe(true);
    await m.send({ to: "a@b.c", subject: "Objet", text: "Corps", kind: "password_reset" });
    await m.send({ to: "d@e.f", subject: "Objet 2", text: "Corps 2", kind: "password_reset" });
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    expect(files).toHaveLength(2);
    const parsed = files.map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as { to: string; kind: string; createdAt: string });
    expect(parsed.map((p) => p.to).sort()).toEqual(["a@b.c", "d@e.f"]);
    expect(parsed.every((p) => p.kind === "password_reset" && !Number.isNaN(Date.parse(p.createdAt)))).toBe(true);
  });
});