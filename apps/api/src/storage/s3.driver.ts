import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type ServerSideEncryption,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Readable } from "node:stream";
import { KEY_PATTERN, type StorageDriver } from "./storage.types";

/**
 * Pilote S3 reel (bloc 3) : AWS S3 ou tout stockage compatible (teste en local
 * sur SeaweedFS, conteneur jetable orya-test-s3).
 *  - bucket prive, aucune ACL publique, aucune URL publique ;
 *  - chiffrement cote serveur exige a chaque ecriture (SSE-S3 "AES256" par
 *    defaut, ou "aws:kms" + STORAGE_S3_KMS_KEY_ID) ;
 *  - lecture : URL pre-signee COURTE (STORAGE_PRESIGN_SECONDS, 30..300 s, defaut
 *    120), Content-Disposition attachment, emise seulement apres controle
 *    d'autorisation et antivirus "clean".
 * Variables : STORAGE_S3_ENDPOINT (optionnel hors AWS), STORAGE_S3_REGION,
 * STORAGE_S3_BUCKET, STORAGE_S3_ACCESS_KEY_ID, STORAGE_S3_SECRET_ACCESS_KEY,
 * STORAGE_S3_FORCE_PATH_STYLE=1, STORAGE_S3_SSE=AES256|aws:kms.
 */
export class S3StorageDriver implements StorageDriver {
  readonly name = "s3";
  readonly encryption: string;
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly sse: ServerSideEncryption;
  private readonly kmsKeyId: string | undefined;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    const bucket = (env.STORAGE_S3_BUCKET ?? "").trim();
    const accessKeyId = (env.STORAGE_S3_ACCESS_KEY_ID ?? "").trim();
    const secretAccessKey = (env.STORAGE_S3_SECRET_ACCESS_KEY ?? "").trim();
    if (!bucket) throw new Error("STORAGE_S3_BUCKET est requis pour STORAGE_DRIVER=s3.");
    const sse = (env.STORAGE_S3_SSE ?? "AES256").trim();
    if (sse !== "AES256" && sse !== "aws:kms") throw new Error("STORAGE_S3_SSE doit valoir AES256 ou aws:kms.");
    this.sse = sse as ServerSideEncryption;
    this.kmsKeyId = sse === "aws:kms" ? (env.STORAGE_S3_KMS_KEY_ID ?? "").trim() || undefined : undefined;
    this.encryption = sse === "aws:kms" ? "sse-kms" : "sse-s3";
    this.bucket = bucket;
    this.client = new S3Client({
      region: (env.STORAGE_S3_REGION ?? "us-east-1").trim(),
      endpoint: (env.STORAGE_S3_ENDPOINT ?? "").trim() || undefined,
      forcePathStyle: (env.STORAGE_S3_FORCE_PATH_STYLE ?? "") === "1",
      credentials: accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined,
    });
  }

  private check(key: string): string {
    if (!KEY_PATTERN.test(key)) throw new Error("Cle de stockage invalide.");
    return key;
  }

  async put(key: string, content: Buffer): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.check(key),
        Body: content,
        ContentLength: content.length,
        // Type neutre a l'ecriture : le type reel est impose a la lecture (URL pre-signee).
        ContentType: "application/octet-stream",
        ServerSideEncryption: this.sse,
        SSEKMSKeyId: this.kmsKeyId,
      }),
    );
  }

  async open(key: string): Promise<Readable> {
    const out = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.check(key) }));
    if (!out.Body) throw new Error("Objet vide.");
    return out.Body as Readable;
  }

  async remove(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.check(key) }));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: this.check(key) }));
      return true;
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 404) return false;
      throw error;
    }
  }

  async presignGet(key: string, opts: { mimeType: string; filename: string; expiresInSeconds: number }): Promise<string> {
    const safe = opts.filename.replace(/[^\w.-]/g, "_");
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: this.check(key),
        ResponseContentType: opts.mimeType,
        ResponseContentDisposition: `attachment; filename="${safe}"`,
        ResponseCacheControl: "private, no-store",
      }),
      { expiresIn: opts.expiresInSeconds },
    );
  }
}