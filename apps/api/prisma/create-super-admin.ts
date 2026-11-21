/**
 * ORYA - creation du PREMIER super-administrateur, sans seed (P0-8b).
 *
 *   npm run admin:create-super-admin -- --email=admin@exemple.ma [--name="Super-admin ORYA"]
 *   (image migrate : node migrate/create-super-admin.js --email=...)
 *
 * - Le mot de passe n'est JAMAIS accepte en parametre ni en variable d'environnement :
 *   il est saisi en interactif (saisie masquee), deux fois, et n'est ni affiche ni journalise.
 * - Politique : 12 a 128 caracteres, au moins 3 familles (minuscules, majuscules, chiffres,
 *   symboles), ne contient pas la partie locale de l'e-mail.
 * - Le compte est cree sans MFA : la connexion renvoie mfaRequired/method=enroll, l'enrolement
 *   TOTP est donc impose a la premiere connexion (MFA_REQUIRED_ROLES contient super_admin).
 * - Refuse s'il existe deja un profil super_admin (verrou consultatif, transaction unique).
 * - Action auditee : AuditLog "admin.super_admin.bootstrap" (severite critical).
 *
 * MODE TEST UNIQUEMENT : si stdin n'est pas un terminal, l'outil refuse, sauf si
 * ORYA_BOOTSTRAP_STDIN=1 ; il lit alors deux lignes sur stdin (tube). Le mot de passe ne
 * passe donc jamais dans argv. Ce mode est reserve aux tests automatises.
 *
 * Connexion : DIRECT_DATABASE_URL (role orya_owner), jamais DATABASE_URL (orya_app).
 * Codes de sortie : 0 cree ; 2 usage ou mot de passe refuse ; 3 super-admin deja present ;
 * 4 e-mail deja utilise ; 1 erreur.
 */
import argon2 from "argon2";
import { PrismaClient } from "@prisma/client";

const BOOTSTRAP_LOCK = 774201;

function fail(code: number, message: string): never {
  process.stderr.write(`[super-admin] ${message}\n`);
  process.exit(code);
}

function parseArgs(argv: string[]): { email: string; name: string } {
  let email = "";
  let name = "Super-admin ORYA";
  for (const arg of argv) {
    if (/pass|pwd|secret|mdp/i.test(arg)) {
      fail(2, "REFUS : aucun mot de passe en parametre. Il est saisi en interactif.");
    }
    if (arg.startsWith("--email=")) email = arg.slice(8).trim().toLowerCase();
    else if (arg.startsWith("--name=")) name = arg.slice(7).trim();
    else fail(2, `argument inconnu : ${arg.split("=")[0]}`);
  }
  if (!/^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 320) {
    fail(2, "usage : --email=<adresse valide> [--name=<nom affiche>]");
  }
  if (name.length < 2 || name.length > 120) fail(2, "nom affiche invalide (2 a 120 caracteres).");
  return { email, name };
}

export function checkPolicy(password: string, email: string): string | null {
  if (password.length < 12) return "au moins 12 caracteres";
  if (password.length > 128) return "au plus 128 caracteres";
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(password)).length;
  if (classes < 3) return "au moins 3 familles parmi minuscules, majuscules, chiffres, symboles";
  const local = email.split("@")[0] ?? "";
  if (local.length >= 4 && password.toLowerCase().includes(local)) return "ne doit pas contenir l'identifiant de l'e-mail";
  if (/^(.)\1+$/.test(password)) return "trop previsible";
  return null;
}

function readHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    process.stderr.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener("data", onData);
          process.stderr.write("\n");
          resolve(value);
          return;
        }
        if (ch === "\u0003") {
          stdin.setRawMode(false);
          process.stderr.write("\n");
          fail(2, "annule.");
        }
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else if (ch >= " ") value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

function readPipedLines(): Promise<string[]> {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c: string) => (data += c));
    // Une console Windows en UTF-8 (chcp 65001) fait preceder le flux d'un BOM : on le retire.
    process.stdin.on("end", () => resolve(data.replace(/^\uFEFF/, "").split(/\r?\n/)));
  });
}

async function readPassword(): Promise<[string, string]> {
  if (process.stdin.isTTY) {
    const first = await readHidden("Mot de passe (saisie masquee) : ");
    const second = await readHidden("Confirmation : ");
    return [first, second];
  }
  if (process.env.ORYA_BOOTSTRAP_STDIN !== "1") {
    fail(2, "REFUS : saisie interactive requise (terminal). Mode tube reserve aux tests (ORYA_BOOTSTRAP_STDIN=1).");
  }
  const lines = await readPipedLines();
  return [lines[0] ?? "", lines[1] ?? ""];
}

async function main(): Promise<void> {
  const { email, name } = parseArgs(process.argv.slice(2));
  const directUrl = process.env.DIRECT_DATABASE_URL;
  if (!directUrl) fail(2, "DIRECT_DATABASE_URL absente (role orya_owner).");
  if (process.env.DATABASE_URL && process.env.DATABASE_URL === directUrl) {
    fail(2, "DIRECT_DATABASE_URL doit etre le role proprietaire, pas le role applicatif.");
  }

  const prisma = new PrismaClient({ datasourceUrl: directUrl });
  try {
    // Controle precoce (sans saisie inutile) ; recontrole sous verrou dans la transaction.
    const existing = await prisma.userProfile.findFirst({ where: { role: "super_admin" }, select: { id: true } });
    if (existing) fail(3, "REFUS : un super-administrateur existe deja. Aucune modification.");

    const [password, confirm] = await readPassword();
    if (password !== confirm) fail(2, "REFUS : les deux saisies different.");
    const policy = checkPolicy(password, email);
    if (policy) fail(2, `REFUS : mot de passe trop faible (${policy}).`);

    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: Number(process.env.ARGON2_MEMORY_COST ?? 19456),
      timeCost: Number(process.env.ARGON2_TIME_COST ?? 2),
      parallelism: Number(process.env.ARGON2_PARALLELISM ?? 1),
    });

    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${BOOTSTRAP_LOCK})`);
      const again = await tx.userProfile.findFirst({ where: { role: "super_admin" }, select: { id: true } });
      if (again) return { code: 3 as const };
      const taken = await tx.user.findUnique({ where: { email }, select: { id: true } });
      if (taken) return { code: 4 as const };
      const user = await tx.user.create({
        data: { email, passwordHash, status: "active", mfaSecret: null, mfaEnrolledAt: null },
        select: { id: true },
      });
      const profile = await tx.userProfile.create({
        data: { userId: user.id, schoolId: null, role: "super_admin", displayName: name },
        select: { id: true },
      });
      await tx.user.update({ where: { id: user.id }, data: { activeProfileId: profile.id }, select: { id: true } });
      await tx.auditLog.create({
        data: {
          actorId: null,
          schoolId: null,
          action: "admin.super_admin.bootstrap",
          entity: "User",
          entityId: user.id,
          severity: "critical",
          metadata: { channel: "cli", mfaEnrollmentRequired: true },
        },
        select: { id: true },
      });
      return { code: 0 as const, userId: user.id };
    });
    if (result.code === 3) fail(3, "REFUS : un super-administrateur existe deja. Aucune modification.");
    if (result.code === 4) fail(4, "REFUS : cette adresse e-mail est deja utilisee.");
    process.stdout.write(`[super-admin] cree (id ${result.userId}). Enrolement MFA impose a la premiere connexion.\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  fail(1, `erreur : ${error instanceof Error ? error.message.split("\n")[0] : "inconnue"}`);
});
