import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/**
 * Primitives cryptographiques du service d'authentification.
 *
 * Aucune dépendance externe : uniquement node:crypto. Les secrets (mot de passe,
 * secret TOTP, jeton de rafraîchissement) ne sont jamais stockés en clair.
 */

/** Empreinte SHA-256 en hexadécimal (jetons de rafraîchissement, invitations). */
export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Jeton aléatoire URL-safe, 32 octets par défaut (256 bits). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Comparaison à temps constant, pour éviter les attaques par mesure de durée. */
export function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

function encryptionKey(keyBase64: string): Buffer {
  const key = Buffer.from(keyBase64, "base64");
  if (key.length !== 32) {
    throw new Error(
      "MFA_ENCRYPTION_KEY doit contenir 32 octets encodés en base64 (44 caractères).",
    );
  }
  return key;
}

/**
 * Chiffre un secret avec AES-256-GCM.
 * Format de sortie : iv.tag.chiffré, chaque partie en base64url.
 */
export function encryptSecret(plain: string, keyBase64: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(keyBase64), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(
    ".",
  );
}

/** Déchiffre un secret produit par encryptSecret. Lève une erreur si le tag est invalide. */
export function decryptSecret(payload: string, keyBase64: string): string {
  const parts = payload.split(".");
  if (parts.length !== 3) {
    throw new Error("Secret chiffré illisible.");
  }

  const [ivPart, tagPart, dataPart] = parts as [string, string, string];
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(keyBase64),
    Buffer.from(ivPart, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataPart, "base64url")),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}
