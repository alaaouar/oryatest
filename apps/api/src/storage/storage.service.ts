import {
  BadRequestException,
  ConflictException,
  GoneException,
  Inject,
  Injectable,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import type { Readable } from "node:stream";
import { AntivirusService, type ScanResult } from "./antivirus";
import { detectMime, extensionMatches } from "./file-signature";
import { inspectZip, looksLikeZip } from "../imports/zip-guard";
import { STORAGE_DRIVER, type AcceptedMime, type StorageDriver } from "./storage.types";

/** 10 Mo (bloc 3). */
export const MAX_UPLOAD_BYTES = Number(process.env.UPLOAD_MAX_BYTES ?? 10 * 1024 * 1024);

export type ValidatedUpload = {
  content: Buffer;
  mimeType: AcceptedMime;
  sizeBytes: number;
  sha256: string;
  originalName: string;
};

export type StoredScan = {
  key: string;
  scanStatus: "clean" | "error";
  scanEngine: string;
  scannedAt: Date;
  encryption: string;
};

export type DownloadTarget =
  | { kind: "url"; url: string; expiresInSeconds: number }
  | { kind: "stream"; stream: Readable; mimeType: string; sizeBytes: number; name: string };

export function presignSeconds(): number {
  const raw = Number(process.env.STORAGE_PRESIGN_SECONDS ?? 120);
  return Math.min(300, Math.max(30, Number.isFinite(raw) ? raw : 120));
}

/** Facade unique : validation (taille, extension, magic bytes), antivirus, ecriture privee chiffree. */
@Injectable()
export class StorageService {
  constructor(
    @Inject(STORAGE_DRIVER) private readonly driver: StorageDriver,
    private readonly antivirus: AntivirusService,
  ) {}

  get driverName(): string {
    return this.driver.name;
  }

  get encryption(): string {
    return this.driver.encryption;
  }

  /**
   * Pipeline pour un contenu analyse mais jamais stocke ni servi (imports CSV/XLSX) :
   * infecte => 422 ; resultat inconnu => 503 (echec ferme, le contenu n'est pas traite).
   */
  async scanOnly(content: Buffer): Promise<{ sha256: string }> {
    const sha256 = createHash("sha256").update(content).digest("hex");
    const scan = await this.antivirus.scan(content);
    if (scan.status === "infected") {
      throw new UnprocessableEntityException("Fichier refuse : contenu malveillant detecte par l'antivirus.");
    }
    if (scan.status !== "clean") {
      throw new ServiceUnavailableException(scan.detail === "scan timeout"
        ? "Delai analyse antivirus depasse : fichier refuse, aucun import traite. Reessayez plus tard."
        : scan.detail === "scanner sature"
          ? "Analyse antivirus saturee : fichier refuse, aucun import traite. Reessayez dans quelques instants."
          : "Analyse antivirus indisponible : fichier non traite, reessayez plus tard.");
    }
    return { sha256 };
  }

  /** Re-analyse d'un fichier deja stocke (commande de reprise des fichiers "pending"/"error"). */
  async rescanStored(key: string): Promise<ScanResult> {
    const stream = await this.driver.open(key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
    return this.antivirus.scan(Buffer.concat(chunks));
  }

  private checkSize(content: Buffer): void {
    if (content.length === 0) {
      throw new BadRequestException("Le fichier est vide.");
    }
    if (content.length > MAX_UPLOAD_BYTES) {
      throw new PayloadTooLargeException(
        `Fichier trop volumineux (${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} Mo maximum).`,
      );
    }
  }

  /** Validation d'un contenu binaire recu par multer. Le MIME declare est ignore. */
  validateBuffer(filename: string, content: Buffer): ValidatedUpload {
    this.checkSize(content);
    const mimeType = detectMime(content);
    if (!mimeType) {
      throw new BadRequestException("Format refuse : seuls les fichiers PDF, JPEG, PNG et HEIC sont acceptes.");
    }
    if (!extensionMatches(filename, mimeType)) {
      throw new BadRequestException("L'extension du fichier ne correspond pas a son contenu.");
    }
    const safeName = filename.replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 120) || "justificatif";
    return {
      content,
      mimeType,
      sizeBytes: content.length,
      sha256: createHash("sha256").update(content).digest("hex"),
      originalName: safeName,
    };
  }

  /** Ecrit le contenu sous une cle aleatoire et renvoie cette cle. */
  async put(schoolId: string, upload: ValidatedUpload): Promise<string> {
    const key = `${schoolId}/${randomBytes(32).toString("hex")}`;
    await this.driver.put(key, upload.content, { mimeType: upload.mimeType });
    return key;
  }

  /**
   * Pipeline bloc 3, etape 1 : taille (413), puis (t52u) metadonnees ZIP sans
   * decompression si le contenu est une archive (400), puis antivirus sur TOUS les octets
   * recus, AVANT le controle de type : un contenu infecte est refuse (422) et
   * audite meme s'il est deguise. Puis type reel par magic bytes (400).
   */
  async intake(filename: string, content: Buffer): Promise<{ infected: ScanResult; sha256: string } | { upload: ValidatedUpload; scan: ScanResult }> {
    this.checkSize(content);
    this.guardArchive(content);
    const scan = await this.antivirus.scan(content);
    if (scan.status === "infected") {
      return { infected: scan, sha256: createHash("sha256").update(content).digest("hex") };
    }
    // t52u : delai depasse ou plafond d'analyses atteint => 503, RIEN n'est ecrit
    // (un scanner injoignable garde le comportement F11 : recu, marque "error", non telechargeable).
    if (scan.detail === "scan timeout") {
      throw new ServiceUnavailableException("Delai analyse antivirus depasse : fichier refuse, rien n'est enregistre. Reessayez plus tard.");
    }
    if (scan.detail === "scanner sature") {
      throw new ServiceUnavailableException("Analyse antivirus saturee : fichier refuse, rien n'est enregistre. Reessayez dans quelques instants.");
    }
    return { upload: this.validateBuffer(filename, content), scan };
  }

  /**
   * t52u : un contenu qui est une archive ZIP (quel que soit son nom) est controle sur
   * les metadonnees de son repertoire central, sans decompression, AVANT l'antivirus :
   * une bombe ZIP est refusee (400) sans appel a clamd et sans ecriture. Une archive
   * saine poursuit le pipeline (antivirus, puis type reel : refusee car non PDF/image).
   */
  private guardArchive(content: Buffer): void {
    if (!looksLikeZip(content)) return;
    const guard = inspectZip(content, { requireOoxml: false });
    if (!guard.ok) {
      throw new BadRequestException(`Fichier refuse : ${guard.reason}.`);
    }
  }

  /**
   * Etape 2 : ecriture privee chiffree. Resultat antivirus inconnu => ecrit mais
   * marque "error", donc jamais telechargeable (echec ferme).
   */
  async store(schoolId: string, upload: ValidatedUpload, scan: ScanResult): Promise<StoredScan> {
    if (scan.status === "infected") throw new Error("Refus : contenu infecte.");
    const key = await this.put(schoolId, upload);
    return {
      key,
      scanStatus: scan.status === "clean" ? "clean" : "error",
      scanEngine: scan.engine,
      scannedAt: new Date(),
      encryption: this.driver.encryption,
    };
  }

  /**
   * Bloc 4 : fichier GENERE par le serveur (export de donnees JSON/PDF). Meme
   * antivirus, mais echec ferme strict : tout resultat autre que "clean" => 503,
   * rien n'est ecrit. Ecriture privee chiffree sous cle aleatoire.
   */
  async storeGenerated(
    schoolId: string,
    content: Buffer,
    mimeType: "application/json" | "application/pdf",
  ): Promise<StoredScan & { sha256: string; sizeBytes: number }> {
    const scan = await this.antivirus.scan(content);
    if (scan.status !== "clean") {
      throw new ServiceUnavailableException("Analyse antivirus indisponible ou negative : export non produit.");
    }
    const key = `${schoolId}/${randomBytes(32).toString("hex")}`;
    await this.driver.put(key, content, { mimeType });
    return {
      key,
      scanStatus: "clean",
      scanEngine: scan.engine,
      scannedAt: new Date(),
      encryption: this.driver.encryption,
      sha256: createHash("sha256").update(content).digest("hex"),
      sizeBytes: content.length,
    };
  }

  /** Lien de telechargement : seulement si l'analyse est "clean" et le fichier non purge. */
  async downloadFor(file: {
    storageKey: string;
    mimeType: string;
    sizeBytes: number;
    originalName: string;
    scanStatus: string;
    purgedAt: Date | null;
  }): Promise<DownloadTarget> {
    if (file.purgedAt) throw new GoneException("Fichier supprime a l'issue de sa duree de conservation.");
    if (file.scanStatus !== "clean") {
      throw new ConflictException("Fichier indisponible : analyse antivirus en attente ou non concluante.");
    }
    const expiresInSeconds = presignSeconds();
    const url = await this.driver.presignGet(file.storageKey, {
      mimeType: file.mimeType,
      filename: file.originalName,
      expiresInSeconds,
    });
    if (url) return { kind: "url", url, expiresInSeconds };
    return {
      kind: "stream",
      stream: await this.driver.open(file.storageKey),
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      name: file.originalName,
    };
  }

  open(key: string): Promise<Readable> {
    return this.driver.open(key);
  }

  exists(key: string): Promise<boolean> {
    return this.driver.exists(key);
  }

  remove(key: string): Promise<void> {
    return this.driver.remove(key);
  }

  async removeQuietly(key: string): Promise<void> {
    await this.driver.remove(key).catch(() => undefined);
  }
}