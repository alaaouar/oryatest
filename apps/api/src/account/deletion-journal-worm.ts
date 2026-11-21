import {
  GetObjectCommand,
  ListObjectVersionsCommand,
  PutObjectCommand,
  S3Client,
  type ListObjectVersionsCommandOutput,
} from "@aws-sdk/client-s3";

/**
 * t62u B3 : copie WORM (ecriture seule, verrouillee) du journal des suppressions.
 *
 * Chaque ligne chainee du journal (deletion-register.ts) est AUSSI ecrite comme un objet
 * distinct dans un bucket S3 dedie, avec :
 *  - Object Lock active sur le bucket et retention par defaut en mode COMPLIANCE (configuree
 *    par l'exploitant, docs/preproduction.md) : aucune version ne peut etre supprimee, ecrasee
 *    ni voir sa retention raccourcie avant echeance, pas meme par le compte racine ;
 *  - identifiants d'ECRITURE SEULE, distincts de ceux du stockage des fichiers : l'API peut
 *    deposer une entree mais ne peut ni lire, ni lister le journal ;
 *  - If-None-Match: * (aucun ecrasement d'une cle existante) et chiffrement SSE-S3.
 * La lecture (rejeu apres restauration) utilise un TROISIEME jeu d'identifiants, lecture et
 * liste seules, fourni a l'operateur au moment du rejeu (jamais a l'API en fonctionnement).
 * Un simple DELETE (marqueur de suppression) ne fait rien disparaitre : le rejeu lit toutes
 * les versions.
 *
 * Variables (aucune valeur n'est jamais journalisee) :
 *  DELETION_JOURNAL_WORM_BUCKET (active la copie WORM), DELETION_JOURNAL_WORM_ENDPOINT,
 *  DELETION_JOURNAL_WORM_REGION, DELETION_JOURNAL_WORM_FORCE_PATH_STYLE=1,
 *  DELETION_JOURNAL_WORM_PREFIX (defaut deletion-journal/v1/),
 *  DELETION_JOURNAL_WORM_WRITER_ACCESS_KEY_ID / _WRITER_SECRET_ACCESS_KEY (API, job),
 *  DELETION_JOURNAL_WORM_READER_ACCESS_KEY_ID / _READER_SECRET_ACCESS_KEY (rejeu seulement),
 *  DELETION_JOURNAL_WORM_REQUIRED=0 pour desactiver l'exigence en production (deconseille).
 */

const DEFAULT_PREFIX = "deletion-journal/v1/";

type Env = NodeJS.ProcessEnv;

function trimmed(env: Env, key: string): string {
  return (env[key] ?? "").trim();
}

export function wormConfigured(env: Env = process.env): boolean {
  return trimmed(env, "DELETION_JOURNAL_WORM_BUCKET").length > 0;
}

/** En production, la copie WORM est exigee (echec ferme) sauf DELETION_JOURNAL_WORM_REQUIRED=0. */
export function wormRequired(env: Env = process.env): boolean {
  return (env.NODE_ENV ?? "") === "production" && trimmed(env, "DELETION_JOURNAL_WORM_REQUIRED") !== "0";
}

function wormPrefix(env: Env): string {
  const p = trimmed(env, "DELETION_JOURNAL_WORM_PREFIX") || DEFAULT_PREFIX;
  if (!/^[A-Za-z0-9._/-]{1,200}$/.test(p)) throw new Error("DELETION_JOURNAL_WORM_PREFIX invalide.");
  return p.endsWith("/") ? p : `${p}/`;
}

function clientFor(env: Env, role: "WRITER" | "READER"): { client: S3Client; bucket: string; prefix: string } {
  const bucket = trimmed(env, "DELETION_JOURNAL_WORM_BUCKET");
  const accessKeyId = trimmed(env, `DELETION_JOURNAL_WORM_${role}_ACCESS_KEY_ID`);
  const secretAccessKey = trimmed(env, `DELETION_JOURNAL_WORM_${role}_SECRET_ACCESS_KEY`);
  if (!bucket) throw new Error("DELETION_JOURNAL_WORM_BUCKET absent.");
  if (!accessKeyId || !secretAccessKey) {
    throw new Error(`Identifiants ${role === "WRITER" ? "d'ecriture" : "de lecture"} du journal WORM absents.`);
  }
  // Identifiants et bucket DISTINCTS du stockage des fichiers : une fuite de l'un ne donne
  // jamais acces a l'autre.
  if (accessKeyId === trimmed(env, "STORAGE_S3_ACCESS_KEY_ID")) {
    throw new Error("Le journal WORM exige des identifiants distincts de ceux du stockage des fichiers (STORAGE_S3_*).");
  }
  if (bucket === trimmed(env, "STORAGE_S3_BUCKET")) {
    throw new Error("Le journal WORM exige un bucket distinct de celui des fichiers.");
  }
  if (role === "WRITER" && accessKeyId === trimmed(env, "DELETION_JOURNAL_WORM_READER_ACCESS_KEY_ID")) {
    throw new Error("Identifiants d'ecriture et de lecture du journal WORM identiques : refuse.");
  }
  const client = new S3Client({
    region: trimmed(env, "DELETION_JOURNAL_WORM_REGION") || "us-east-1",
    endpoint: trimmed(env, "DELETION_JOURNAL_WORM_ENDPOINT") || undefined,
    forcePathStyle: trimmed(env, "DELETION_JOURNAL_WORM_FORCE_PATH_STYLE") === "1",
    credentials: { accessKeyId, secretAccessKey },
    maxAttempts: 2,
  });
  return { client, bucket, prefix: wormPrefix(env) };
}

/** Cle d'objet : horodatage compact + MAC de la ligne (unique, sans donnee personnelle). */
export function wormKey(prefix: string, anonymizedAt: string, mac: string): string {
  if (!/^[0-9a-f]{64}$/.test(mac)) throw new Error("MAC de ligne invalide.");
  return `${prefix}${anonymizedAt.replace(/[^0-9]/g, "").slice(0, 17)}-${mac}.json`;
}

/** Depose une ligne du journal (ecriture seule). Toute erreur remonte : la suppression est annulee. */
export async function wormAppend(line: string, anonymizedAt: string, mac: string, env: Env = process.env): Promise<void> {
  const { client, bucket, prefix } = clientFor(env, "WRITER");
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: wormKey(prefix, anonymizedAt, mac),
        Body: Buffer.from(`${line}\n`, "utf8"),
        ContentType: "application/json",
        IfNoneMatch: "*",
        ServerSideEncryption: "AES256",
      }),
    );
  } catch (error) {
    const name = (error as { name?: string }).name ?? "erreur";
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode ?? 0;
    throw new Error(`Copie WORM du journal impossible (${name}, HTTP ${status}) : anonymisation annulee.`);
  } finally {
    client.destroy();
  }
}

export type WormRead = { lines: string[]; objects: number; versions: number; locked: number; unlocked: number; deleteMarkers: number };

/** Lit TOUTES les versions du journal WORM (identifiants de lecture). Les marqueurs de suppression sont ignores. */
export async function wormReadAll(env: Env = process.env): Promise<WormRead> {
  const { client, bucket, prefix } = clientFor(env, "READER");
  const out: WormRead = { lines: [], objects: 0, versions: 0, locked: 0, unlocked: 0, deleteMarkers: 0 };
  const keys = new Set<string>();
  try {
    let keyMarker: string | undefined;
    let versionMarker: string | undefined;
    for (;;) {
      const page: ListObjectVersionsCommandOutput = await client.send(
        new ListObjectVersionsCommand({ Bucket: bucket, Prefix: prefix, KeyMarker: keyMarker, VersionIdMarker: versionMarker }),
      );
      out.deleteMarkers += (page.DeleteMarkers ?? []).length;
      for (const v of page.Versions ?? []) {
        if (!v.Key) continue;
        const obj = await client.send(new GetObjectCommand({ Bucket: bucket, Key: v.Key, VersionId: v.VersionId }));
        const text = obj.Body ? await obj.Body.transformToString("utf8") : "";
        keys.add(v.Key);
        out.versions += 1;
        const until = obj.ObjectLockRetainUntilDate ? new Date(obj.ObjectLockRetainUntilDate).getTime() : 0;
        if (obj.ObjectLockMode === "COMPLIANCE" && until > Date.now()) out.locked += 1;
        else out.unlocked += 1;
        for (const l of text.split("\n")) if (l.trim()) out.lines.push(l.trim());
      }
      if (!page.IsTruncated) break;
      keyMarker = page.NextKeyMarker;
      versionMarker = page.NextVersionIdMarker;
    }
  } finally {
    client.destroy();
  }
  out.objects = keys.size;
  return out;
}
