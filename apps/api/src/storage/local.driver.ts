import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { KEY_PATTERN, type StorageDriver } from "./storage.types";

const MAGIC = Buffer.from("ORYAENC1", "latin1");

/**
 * Pilote de developpement : systeme de fichiers prive, hors de la racine web,
 * fichiers 0600. Chiffrement applicatif AES-256-GCM si STORAGE_ENCRYPTION_KEY
 * (32 octets base64) est fournie : format MAGIC | iv(12) | tag(16) | chiffre.
 * Les fichiers anterieurs (non chiffres) restent lisibles.
 */
export class LocalStorageDriver implements StorageDriver {
  readonly name = "local";
  readonly encryption: string;
  private readonly root: string;
  private readonly key: Buffer | null;

  constructor(root: string, keyBase64?: string) {
    if (!isAbsolute(root)) {
      throw new Error("STORAGE_LOCAL_DIR doit etre un chemin absolu.");
    }
    this.root = resolve(root);
    if (keyBase64) {
      const key = Buffer.from(keyBase64, "base64");
      if (key.length !== 32) throw new Error("STORAGE_ENCRYPTION_KEY doit contenir 32 octets en base64.");
      this.key = key;
    } else {
      this.key = null;
    }
    this.encryption = this.key ? "aes-256-gcm" : "none";
  }

  private pathFor(key: string): string {
    if (!KEY_PATTERN.test(key)) {
      throw new Error("Cle de stockage invalide.");
    }
    const full = resolve(join(this.root, ...key.split("/")));
    if (!full.startsWith(this.root + sep)) {
      throw new Error("Cle de stockage hors du dossier prive.");
    }
    return full;
  }

  async put(key: string, content: Buffer): Promise<void> {
    const full = this.pathFor(key);
    await mkdir(resolve(full, ".."), { recursive: true, mode: 0o700 });
    let data = content;
    if (this.key) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", this.key, iv);
      const enc = Buffer.concat([cipher.update(content), cipher.final()]);
      data = Buffer.concat([MAGIC, iv, cipher.getAuthTag(), enc]);
    }
    await writeFile(full, data, { mode: 0o600, flag: "wx" });
  }

  async open(key: string): Promise<Readable> {
    const full = this.pathFor(key);
    await stat(full);
    const head = await readFile(full).then((b) => b);
    if (head.length >= MAGIC.length && head.subarray(0, MAGIC.length).equals(MAGIC)) {
      if (!this.key) throw new Error("Fichier chiffre : STORAGE_ENCRYPTION_KEY absente.");
      const iv = head.subarray(8, 20);
      const tag = head.subarray(20, 36);
      const decipher = createDecipheriv("aes-256-gcm", this.key, iv);
      decipher.setAuthTag(tag);
      return Readable.from(Buffer.concat([decipher.update(head.subarray(36)), decipher.final()]));
    }
    return createReadStream(full);
  }

  async remove(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    return stat(this.pathFor(key)).then(() => true, () => false);
  }

  async presignGet(): Promise<string | null> {
    return null;
  }
}