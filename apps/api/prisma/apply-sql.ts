/**
 * ORYA - applique les fichiers SQL de prisma/sql avec le rôle propriétaire.
 *
 *   npm run db:rls                      -> 010_rls.sql seul (usage dev, inchangé)
 *   APPLY_ROLES=1 node apply-sql.js     -> 000_roles.sql puis 010_rls.sql
 *   (ou argument --with-roles)
 *
 * Pourquoi un script et pas une migration Prisma ?
 *   - le RLS n'est pas géré par Prisma Migrate ;
 *   - les fichiers doivent rester idempotents et rejouables après chaque migration ;
 *   - les privilèges dépendent de tables qui n'existent qu'après la migration.
 *
 * En conteneur (cible "migrate" de deploy/Dockerfile.api), ce fichier est compilé
 * en JavaScript au build : aucune dépendance à tsx à l'exécution.
 *
 * Le script exige DIRECT_DATABASE_URL (rôle propriétaire / administrateur). Il refuse
 * explicitement de s'exécuter avec DATABASE_URL, qui est soumis au RLS.
 * Si ORYA_APP_PASSWORD est défini (avec les rôles), le mot de passe du rôle orya_app
 * est (re)défini ; il n'est jamais affiché.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

const SEPARATOR = /^-- @@\s*$/m;

function fail(message: string): never {
  console.error(`\n[db:rls] ${message}\n`);
  process.exit(1);
}

const directUrl = process.env.DIRECT_DATABASE_URL;
if (!directUrl) {
  fail(
    "DIRECT_DATABASE_URL est absente. Copiez .env.example vers .env et renseignez le rôle orya_owner.",
  );
}
if (process.env.DATABASE_URL && directUrl === process.env.DATABASE_URL) {
  fail(
    "DIRECT_DATABASE_URL et DATABASE_URL sont identiques. Le RLS doit être appliqué avec le rôle propriétaire (orya_owner), jamais avec le rôle applicatif.",
  );
}

const withRoles = process.env.APPLY_ROLES === "1" || process.argv.includes("--with-roles");
const sqlDir = process.env.SQL_DIR ?? join(__dirname, "sql");
const files = withRoles ? ["000_roles.sql", "010_rls.sql"] : ["010_rls.sql"];

function load(file: string): string[] {
  return readFileSync(join(sqlDir, file), "utf8")
    .split(SEPARATOR)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0);
}

const batches = files.map((file) => ({ file, statements: load(file) }));
const appPassword = process.env.ORYA_APP_PASSWORD;

const prisma = new PrismaClient({ datasourceUrl: directUrl });

async function main(): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      for (const { file, statements } of batches) {
        console.log(`[db:rls] ${statements.length} instructions trouvées dans sql/${file}`);
        for (const [index, statement] of statements.entries()) {
          try {
            await tx.$executeRawUnsafe(statement);
          } catch (error) {
            const preview = statement.replace(/\s+/g, " ").slice(0, 160);
            console.error(`[db:rls] échec de l'instruction ${index + 1} de ${file} : ${preview}...`);
            throw error;
          }
        }
        if (file === "000_roles.sql" && appPassword) {
          // ALTER ROLE n'accepte pas de paramètre lié : littéral échappé, jamais journalisé.
          await tx.$executeRawUnsafe(
            `ALTER ROLE orya_app PASSWORD '${appPassword.replace(/'/g, "''")}'`,
          );
          console.log("[db:rls] mot de passe du rôle orya_app défini (non affiché).");
        }
      }
    },
    { timeout: 120_000 },
  );

  // A1 (P0-3) : bloquant. Le job migrate echoue si orya_auth ne possede pas les fonctions.
  const owners = await prisma.$queryRaw<{ proname: string; owner: string }[]>`
    SELECT p.proname::text AS proname, pg_catalog.pg_get_userbyid(p.proowner)::text AS owner
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('orya_auth_credentials', 'orya_auth_mfa_state')`;
  if (owners.length !== 2 || owners.some((row) => row.owner !== "orya_auth")) {
    fail("orya_auth doit posseder orya_auth_credentials et orya_auth_mfa_state (deploiement refuse).");
  }
  console.log("[db:rls] proprietaire des fonctions d'authentification : orya_auth (verifie).");
  console.log(`[db:rls] ${withRoles ? "Rôles, " : ""}RLS, triggers et privilèges appliqués.`);
}

main()
  .catch((error: unknown) => {
    console.error("[db:rls]", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
