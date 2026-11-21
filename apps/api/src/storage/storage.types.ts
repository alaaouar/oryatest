import type { Readable } from "node:stream";

/**
 * Pilote de stockage prive (bloc 3). Aucun objet n'est public : la lecture passe
 * soit par un flux servi par l'API (pilote local), soit par une URL pre-signee
 * COURTE emise apres controle d'autorisation et d'antivirus (pilote S3).
 */
export interface StorageDriver {
  readonly name: string;
  /** Chiffrement au repos applique : "sse-s3", "sse-kms", "aes-256-gcm" ou "none". */
  readonly encryption: string;
  put(key: string, content: Buffer, meta: { mimeType: string }): Promise<void>;
  open(key: string): Promise<Readable>;
  /** Retrait d'un objet (orphelin ou purge de conservation). */
  remove(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  /** URL pre-signee de lecture (S3) ; null si le pilote sert en flux (local). */
  presignGet(key: string, opts: { mimeType: string; filename: string; expiresInSeconds: number }): Promise<string | null>;
}

export const STORAGE_DRIVER = Symbol("STORAGE_DRIVER");

export type AcceptedMime = "application/pdf" | "image/jpeg" | "image/png" | "image/heic";

/** Cle generee par le serveur : <uuid ecole>/<64 hex>. Rien ne vient du client. */
export const KEY_PATTERN = /^[0-9a-f-]{36}\/[0-9a-f]{64}$/;