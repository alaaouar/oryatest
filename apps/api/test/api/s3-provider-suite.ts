/**
 * t62u B2 - Harnais de test du fournisseur S3 REEL (ou compatible) via le pilote de l'application
 * (src/storage/s3.driver.ts), sans rien d'autre que les variables STORAGE_S3_* :
 *   STORAGE_S3_BUCKET, STORAGE_S3_REGION, STORAGE_S3_ENDPOINT (hors AWS), STORAGE_S3_FORCE_PATH_STYLE,
 *   STORAGE_S3_ACCESS_KEY_ID, STORAGE_S3_SECRET_ACCESS_KEY, STORAGE_S3_SSE (AES256 | aws:kms),
 *   STORAGE_S3_KMS_KEY_ID ; S3_HARNESS_EXPIRY_SECONDS (defaut 5).
 * Controles : chiffrement cote serveur, URL pre-signee (contenu, en-tetes, EXPIRATION), refus d'acces
 * (sans signature, signature alteree, autre cle, mauvais secret, liste anonyme, ecriture anonyme),
 * suppression effective. N'ecrit que sous une cle aleatoire de test, supprimee en fin de suite.
 * N'affiche JAMAIS les identifiants : seuls l'hote de l'endpoint et le nom du bucket sont affiches.
 * S3_HARNESS_CREATE_BUCKET=1 (accepte UNIQUEMENT pour un endpoint 127.0.0.1/localhost : S3 jetable).
 * Usage : scripts/test-s3-provider.ps1 (fournisseur) ou scripts/test-s3-provider.ps1 -Disposable.
 */
import { CreateBucketCommand, DeleteBucketCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { randomBytes, randomUUID } from "node:crypto";
import { S3StorageDriver } from "../../src/storage/s3.driver";

const env = process.env;
let ok = 0;
let ko = 0;
function check(cond: boolean, label: string): void {
  if (cond) { ok += 1; console.log(`  S3P OK - ${label}`); } else { ko += 1; console.log(`  S3P KO - ${label}`); }
}
const status = async (fn: () => Promise<unknown>): Promise<number> => {
  try { await fn(); return 200; } catch (e) { return (e as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode ?? -1; }
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const bucket = (env.STORAGE_S3_BUCKET ?? "").trim();
  const endpoint = (env.STORAGE_S3_ENDPOINT ?? "").trim();
  const region = (env.STORAGE_S3_REGION ?? "us-east-1").trim();
  const forcePathStyle = (env.STORAGE_S3_FORCE_PATH_STYLE ?? "") === "1";
  const accessKeyId = (env.STORAGE_S3_ACCESS_KEY_ID ?? "").trim();
  const secretAccessKey = (env.STORAGE_S3_SECRET_ACCESS_KEY ?? "").trim();
  const sse = (env.STORAGE_S3_SSE ?? "AES256").trim();
  const expiry = Math.max(1, Math.min(60, Number(env.S3_HARNESS_EXPIRY_SECONDS ?? 5) || 5));
  if (!bucket || !accessKeyId || !secretAccessKey) {
    console.log("  S3P KO - variables STORAGE_S3_BUCKET / STORAGE_S3_ACCESS_KEY_ID / STORAGE_S3_SECRET_ACCESS_KEY requises");
    console.log("S3PROVIDER : 0 OK, 1 KO");
    process.exit(1);
  }
  const host = endpoint ? new URL(endpoint).host : `s3.${region}.amazonaws.com`;
  const local = /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host);
  console.log(`CIBLE endpoint=${host} bucket=${bucket} region=${region} sse=${sse} expiration=${expiry}s${local ? " (local jetable)" : ""}`);

  const client = new S3Client({ region, endpoint: endpoint || undefined, forcePathStyle, credentials: { accessKeyId, secretAccessKey } });
  let createdBucket = false;
  if (env.S3_HARNESS_CREATE_BUCKET === "1") {
    if (!local) throw new Error("S3_HARNESS_CREATE_BUCKET refuse hors endpoint local jetable.");
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
    createdBucket = true;
  }

  const driver = new S3StorageDriver(env);
  const key = `${randomUUID()}/${randomBytes(32).toString("hex")}`;
  const [prefix, leaf] = key.split("/") as [string, string];
  const otherLeaf = randomBytes(32).toString("hex");
  const other = `${prefix}/${otherLeaf}`;
  const content = Buffer.from(`ORYA harnais S3 fictif ${randomUUID()}\n`);
  try {
    // S1 : ecriture par le pilote, chiffrement cote serveur.
    await driver.put(key, content);
    const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    check(head.ServerSideEncryption === sse, `S1: objet ecrit par le pilote, chiffre cote serveur (${head.ServerSideEncryption ?? "aucun"})`);
    check(await driver.exists(key), "S1: exists() = vrai");

    // S2 : URL pre-signee courte, contenu et en-tetes de reponse imposes.
    const url = await driver.presignGet(key, { mimeType: "application/pdf", filename: "piece jointe.pdf", expiresInSeconds: expiry });
    const u = new URL(url);
    check(u.searchParams.get("X-Amz-Expires") === String(expiry), `S2: URL pre-signee (signature v4, X-Amz-Expires=${u.searchParams.get("X-Amz-Expires")})`);
    const r1 = await fetch(url);
    const body1 = Buffer.from(await r1.arrayBuffer());
    check(r1.status === 200 && body1.equals(content), `S2: URL pre-signee valide -> 200, contenu identique (${r1.status})`);
    check((r1.headers.get("content-disposition") ?? "").startsWith("attachment;") && (r1.headers.get("content-type") ?? "") === "application/pdf",
      "S2: Content-Disposition attachment et Content-Type imposes par la signature");
    check((r1.headers.get("cache-control") ?? "").includes("no-store"), "S2: Cache-Control private, no-store");

    // S3 : refus d'acces.
    const unsigned = new URL(url); unsigned.search = "";
    check((await fetch(unsigned)).status === 403, "S3: lecture sans signature (URL nue) -> 403 (bucket prive)");
    const tampered = new URL(url);
    const sig = tampered.searchParams.get("X-Amz-Signature") ?? "";
    tampered.searchParams.set("X-Amz-Signature", (sig[0] === "0" ? "1" : "0") + sig.slice(1));
    check((await fetch(tampered)).status === 403, "S3: signature alteree -> 403");
    const swapped = new URL(url.replace(leaf, otherLeaf));
    check((await fetch(swapped)).status === 403, "S3: URL signee pour une cle, utilisee pour une autre -> 403");
    const listUrl = new URL(url); listUrl.search = ""; listUrl.pathname = forcePathStyle ? `/${bucket}` : "/";
    check((await fetch(listUrl)).status === 403, "S3: liste anonyme du bucket -> 403");
    const anonPut = await fetch(unsigned, { method: "PUT", body: "intrus" });
    check(anonPut.status === 403, `S3: ecriture anonyme -> 403 (${anonPut.status})`);
    const bad = new S3Client({ region, endpoint: endpoint || undefined, forcePathStyle, credentials: { accessKeyId, secretAccessKey: `${secretAccessKey}x` } });
    check((await status(() => bad.send(new HeadObjectCommand({ Bucket: bucket, Key: key })))) === 403, "S3: mauvais secret -> 403");
    const plain = await status(() => client.send(new PutObjectCommand({ Bucket: bucket, Key: other, Body: Buffer.from("x") })));
    if (plain === 200) {
      const h = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: other }));
      console.log(`  S3P INFO - ecriture SANS en-tete SSE acceptee ; chiffrement applique par defaut : ${h.ServerSideEncryption ?? "AUCUN"}`);
      await driver.remove(other);
    } else {
      console.log(`  S3P INFO - ecriture sans en-tete SSE refusee par le fournisseur (${plain})`);
    }

    // S4 : expiration de l'URL pre-signee.
    await sleep((expiry + 3) * 1000);
    const r2 = await fetch(url);
    check(r2.status === 403, `S4: URL pre-signee expiree (${expiry + 3} s) -> 403 (${r2.status})`);

    // S5 : suppression effective.
    await driver.remove(key);
    check(!(await driver.exists(key)), "S5: remove() puis exists() = faux");
    const fresh = await driver.presignGet(key, { mimeType: "text/plain", filename: "x.txt", expiresInSeconds: 30 });
    const r3 = await fetch(fresh);
    check(r3.status === 404 || r3.status === 403, `S5: objet supprime -> URL pre-signee neuve refusee (${r3.status})`);
  } finally {
    await driver.remove(key).catch(() => undefined);
    await driver.remove(other).catch(() => undefined);
    if (createdBucket) await client.send(new DeleteBucketCommand({ Bucket: bucket })).catch(() => undefined);
  }
  console.log(`S3PROVIDER : ${ok} OK, ${ko} KO`);
  process.exit(ko > 0 ? 1 : 0);
}

main().catch((e) => {
  // Message seul (jamais la configuration ni les identifiants).
  console.log(`  S3P KO - ${e instanceof Error ? e.message : "erreur"}`);
  console.log(`S3PROVIDER : ${ok} OK, ${ko + 1} KO`);
  process.exit(1);
});
