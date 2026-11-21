#!/usr/bin/env node
/**
 * Bloc 3 - outils S3 de test (bucket, HEAD, GET non signe, GET d'une URL pre-signee).
 * Identifiants lus dans STORAGE_S3_* (environnement, jamais en argument ni affiches).
 * Usage : node b3-s3.mjs create-bucket | head <key> | unsigned <key> | fetch-url (URL dans ORYA_T_URL)
 */
import { CreateBucketCommand, HeadObjectCommand, PutObjectCommand, PutPublicAccessBlockCommand, S3Client } from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";

const env = process.env;
const client = new S3Client({
  region: env.STORAGE_S3_REGION ?? "us-east-1",
  endpoint: env.STORAGE_S3_ENDPOINT,
  forcePathStyle: true,
  credentials: { accessKeyId: env.STORAGE_S3_ACCESS_KEY_ID, secretAccessKey: env.STORAGE_S3_SECRET_ACCESS_KEY },
});
const Bucket = env.STORAGE_S3_BUCKET;
const [cmd, key] = process.argv.slice(2);
const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");

if (cmd === "put") {
  // Objet de test (reprise "pending") : PDF sain ou EICAR construit en memoire, chiffre SSE.
  const parts = ["X5O!P%@AP[4\\PZX54(P^)7CC)7}$", "EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$", "H+H*"];
  const body = env.ORYA_T_GEN === "eicar" ? Buffer.from(parts.join(""), "latin1") : Buffer.from("%PDF-1.4\n% legacy\n%%EOF\n", "latin1");
  await client.send(new PutObjectCommand({ Bucket, Key: key, Body: body, ServerSideEncryption: "AES256", ContentType: "application/pdf" }));
  out({ ok: true, size: body.length, sha256: createHash("sha256").update(body).digest("hex") });
  process.exit(0);
}

if (cmd === "create-bucket") {
  try {
    await client.send(new CreateBucketCommand({ Bucket }));
  } catch (e) {
    // relance de la suite sur le meme conteneur jetable : bucket deja cree par nous
    if (!["BucketAlreadyOwnedByYou", "BucketAlreadyExists"].includes(e?.name)) throw e;
  }
  let pab = "non supporte";
  try {
    await client.send(new PutPublicAccessBlockCommand({ Bucket, PublicAccessBlockConfiguration: { BlockPublicAcls: true, IgnorePublicAcls: true, BlockPublicPolicy: true, RestrictPublicBuckets: true } }));
    pab = "ok";
  } catch { /* stockage compatible sans cette API : le bucket reste prive par defaut */ }
  out({ ok: true, publicAccessBlock: pab });
} else if (cmd === "head") {
  try {
    const h = await client.send(new HeadObjectCommand({ Bucket, Key: key }));
    out({ exists: true, sse: h.ServerSideEncryption ?? null, contentType: h.ContentType ?? null });
  } catch (e) {
    out({ exists: false, status: e?.$metadata?.httpStatusCode ?? null });
  }
} else if (cmd === "unsigned") {
  const r = await fetch(`${env.STORAGE_S3_ENDPOINT}/${Bucket}/${key}`);
  out({ status: r.status });
} else if (cmd === "fetch-url") {
  const u = new URL(env.ORYA_T_URL);
  const r = await fetch(u);
  const b = Buffer.from(await r.arrayBuffer());
  out({
    status: r.status,
    sha256: createHash("sha256").update(b).digest("hex"),
    expires: Number(u.searchParams.get("X-Amz-Expires")),
    disposition: r.headers.get("content-disposition"),
    contentType: r.headers.get("content-type"),
  });
} else {
  console.error("commande inconnue");
  process.exit(2);
}