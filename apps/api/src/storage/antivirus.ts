import { Injectable, Logger } from "@nestjs/common";
import { Socket } from "node:net";

export type ScanResult = {
  /** clean : aucun virus ; infected : signature trouvee ; error : resultat inconnu (echec ferme). */
  status: "clean" | "infected" | "error";
  engine: string;
  signature?: string;
  detail?: string;
};

const CHUNK = 64 * 1024;

/**
 * Antivirus ClamAV (clamd, protocole INSTREAM sur TCP). Echec ferme : scanner
 * non configure, injoignable, delai depasse ou reponse inattendue => "error",
 * et le fichier reste NON telechargeable.
 * Variables : CLAMAV_HOST, CLAMAV_PORT (3310), CLAMAV_TIMEOUT_MS (30000 : t52u, les
 * archives ZIP sont controlees sur metadonnees AVANT l'antivirus, plus besoin de marge),
 * CLAMAV_MAX_CONCURRENT (4) : plafond d'analyses simultanees par processus API ; au-dela,
 * refus immediat "scanner sature" (echec ferme, 503 sans ecriture), jamais de file infinie.
 */
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_CONCURRENT = 4;
let activeScans = 0;

function intEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

/** Nombre d'analyses en cours (diagnostic et tests). */
export function activeScanCount(): number {
  return activeScans;
}
@Injectable()
export class AntivirusService {
  private readonly logger = new Logger(AntivirusService.name);

  async scan(content: Buffer): Promise<ScanResult> {
    const host = (process.env.CLAMAV_HOST ?? "").trim();
    const port = Number(process.env.CLAMAV_PORT ?? 3310);
    const timeoutMs = Math.max(1000, intEnv("CLAMAV_TIMEOUT_MS", DEFAULT_TIMEOUT_MS));
    const maxConcurrent = intEnv("CLAMAV_MAX_CONCURRENT", DEFAULT_MAX_CONCURRENT);
    const engine = "clamav";
    if (!host) return { status: "error", engine, detail: "scanner non configure" };
    if (activeScans >= maxConcurrent) {
      this.logger.warn(`Analyse antivirus saturee (echec ferme) : ${activeScans}/${maxConcurrent} en cours`);
      return { status: "error", engine, detail: "scanner sature" };
    }

    activeScans += 1;
    try {
      const reply = await new Promise<string>((resolve, reject) => {
        const socket = new Socket();
        const chunks: Buffer[] = [];
        const timer = setTimeout(() => {
          socket.destroy();
          reject(new Error("delai depasse"));
        }, timeoutMs);
        socket.once("error", (err) => {
          clearTimeout(timer);
          reject(err);
        });
        socket.on("data", (d: Buffer) => chunks.push(d));
        socket.once("close", () => {
          clearTimeout(timer);
          resolve(Buffer.concat(chunks).toString("utf8"));
        });
        socket.connect(port, host, () => {
          socket.write("zINSTREAM\0");
          for (let i = 0; i < content.length; i += CHUNK) {
            const part = content.subarray(i, i + CHUNK);
            const len = Buffer.alloc(4);
            len.writeUInt32BE(part.length, 0);
            socket.write(len);
            socket.write(part);
          }
          socket.end(Buffer.alloc(4));
        });
      });
      const text = reply.replace(/\0/g, "").trim();
      if (/^stream: OK$/.test(text)) return { status: "clean", engine };
      const found = /^stream: (.+) FOUND$/.exec(text);
      if (found) return { status: "infected", engine, signature: found[1]!.slice(0, 120) };
      this.logger.warn(`Reponse antivirus inattendue (echec ferme) : ${text.slice(0, 80)}`);
      return { status: "error", engine, detail: "reponse inattendue" };
    } catch (error) {
      const timedOut = error instanceof Error && error.message === "delai depasse";
      this.logger.warn(timedOut
        ? `Delai d'analyse antivirus depasse (${timeoutMs} ms, echec ferme)`
        : `Antivirus injoignable (echec ferme) : ${error instanceof Error ? error.message : "inconnu"}`);
      return { status: "error", engine, detail: timedOut ? "scan timeout" : "scanner injoignable" };
    } finally {
      activeScans -= 1;
    }
  }
}