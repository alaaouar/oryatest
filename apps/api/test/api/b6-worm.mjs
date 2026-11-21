#!/usr/bin/env node
/**
 * t62u B3 - outils de test du journal WORM sur le S3 JETABLE orya-test-s3 (jamais un vrai fournisseur).
 * Identifiants lus dans l'environnement (jamais en argument, jamais affiches) :
 *   ORYA_T_S3_ADMIN_ID / ORYA_T_S3_ADMIN_SECRET   (administrateur du conteneur jetable)
 *   DELETION_JOURNAL_WORM_WRITER_* / DELETION_JOURNAL_WORM_READER_*, DELETION_JOURNAL_WORM_BUCKET, _ENDPOINT
 * Commandes : setup <jours> | stats | probe-writer | probe-admin
 * Sortie : une ligne JSON (statuts HTTP et compteurs seulement).
 */
import {
  CreateBucketCommand, DeleteObjectCommand, GetObjectCommand, GetObjectLockConfigurationCommand, ListObjectVersionsCommand,
  PutObjectCommand, PutObjectLockConfigurationCommand, PutObjectRetentionCommand, S3Client,
} from "@aws-sdk/client-s3";

const env = process.env;
const Bucket = env.DELETION_JOURNAL_WORM_BUCKET;
const Prefix = env.DELETION_JOURNAL_WORM_PREFIX || "deletion-journal/v1/";
const mk = (id, secret) => new S3Client({ region: "us-east-1", endpoint: env.DELETION_JOURNAL_WORM_ENDPOINT, forcePathStyle: true, credentials: { accessKeyId: id, secretAccessKey: secret }, maxAttempts: 1 });
const admin = () => mk(env.ORYA_T_S3_ADMIN_ID, env.ORYA_T_S3_ADMIN_SECRET);
const writer = () => mk(env.DELETION_JOURNAL_WORM_WRITER_ACCESS_KEY_ID, env.DELETION_JOURNAL_WORM_WRITER_SECRET_ACCESS_KEY);
const reader = () => mk(env.DELETION_JOURNAL_WORM_READER_ACCESS_KEY_ID, env.DELETION_JOURNAL_WORM_READER_SECRET_ACCESS_KEY);
const status = async (fn) => { try { await fn(); return 200; } catch (e) { return e?.$metadata?.httpStatusCode ?? -1; } };
const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
async function versions(c) {
  const r = await c.send(new ListObjectVersionsCommand({ Bucket, Prefix }));
  return { versions: r.Versions ?? [], markers: r.DeleteMarkers ?? [] };
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === "setup") {
  const c = admin();
  await c.send(new CreateBucketCommand({ Bucket, ObjectLockEnabledForBucket: true }));
  await c.send(new PutObjectLockConfigurationCommand({ Bucket, ObjectLockConfiguration: { ObjectLockEnabled: "Enabled", Rule: { DefaultRetention: { Mode: "COMPLIANCE", Days: Number(arg || 1) } } } }));
  const conf = (await c.send(new GetObjectLockConfigurationCommand({ Bucket }))).ObjectLockConfiguration;
  // Bucket voisin EXISTANT : l'identite d'ecriture du journal ne doit pas pouvoir y ecrire.
  await c.send(new CreateBucketCommand({ Bucket: Bucket + "-autre" }));
  out({ ok: true, lock: conf?.ObjectLockEnabled, mode: conf?.Rule?.DefaultRetention?.Mode, days: conf?.Rule?.DefaultRetention?.Days });
} else if (cmd === "stats") {
  const c = admin();
  const { versions: v, markers } = await versions(c);
  let locked = 0, sse = 0;
  for (const x of v) {
    const o = await c.send(new GetObjectCommand({ Bucket, Key: x.Key, VersionId: x.VersionId }));
    if (o.ObjectLockMode === "COMPLIANCE" && new Date(o.ObjectLockRetainUntilDate).getTime() > Date.now()) locked += 1;
    if (o.ServerSideEncryption === "AES256") sse += 1;
    await o.Body?.transformToString();
  }
  out({ versions: v.length, keys: new Set(v.map((x) => x.Key)).size, locked, sse, markers: markers.length });
} else if (cmd === "probe-writer") {
  // Identifiants d'ecriture seule : ni lecture, ni liste, ni suppression d'une version, ni ecrasement.
  const w = writer(); const a = admin();
  const { versions: v } = await versions(a);
  const first = v[0];
  out({
    get: await status(() => w.send(new GetObjectCommand({ Bucket, Key: first.Key, VersionId: first.VersionId }))),
    list: await status(() => w.send(new ListObjectVersionsCommand({ Bucket, Prefix }))),
    deleteVersion: await status(() => w.send(new DeleteObjectCommand({ Bucket, Key: first.Key, VersionId: first.VersionId }))),
    overwrite: await status(() => w.send(new PutObjectCommand({ Bucket, Key: first.Key, Body: Buffer.from("falsifie"), IfNoneMatch: "*" }))),
    otherBucket: await status(() => w.send(new PutObjectCommand({ Bucket: Bucket + "-autre", Key: "x", Body: Buffer.from("x") }))),
    readerPut: await status(() => reader().send(new PutObjectCommand({ Bucket, Key: Prefix + "faux.json", Body: Buffer.from("{}") }))),
    readerDeleteVersion: await status(() => reader().send(new DeleteObjectCommand({ Bucket, Key: first.Key, VersionId: first.VersionId }))),
  });
} else if (cmd === "probe-admin") {
  // Meme l'administrateur du stockage : suppression d'une version, contournement et retention raccourcie refuses.
  const a = admin();
  const { versions: v } = await versions(a);
  const first = v[0];
  const dv = await status(() => a.send(new DeleteObjectCommand({ Bucket, Key: first.Key, VersionId: first.VersionId })));
  const bypass = await status(() => a.send(new DeleteObjectCommand({ Bucket, Key: first.Key, VersionId: first.VersionId, BypassGovernanceRetention: true })));
  const shorten = await status(() => a.send(new PutObjectRetentionCommand({ Bucket, Key: first.Key, VersionId: first.VersionId, Retention: { Mode: "COMPLIANCE", RetainUntilDate: new Date(Date.now() + 60_000) } })));
  // Suppression simple : ne cree qu'un marqueur, la version verrouillee reste lisible.
  const simple = await status(() => a.send(new DeleteObjectCommand({ Bucket, Key: first.Key })));
  const after = await versions(a);
  out({ deleteVersion: dv, bypass, shorten, simpleDelete: simple, versionsAfter: after.versions.length, markersAfter: after.markers.length });
} else {
  console.error("commande inconnue");
  process.exit(2);
}
