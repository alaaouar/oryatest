import { BadRequestException, PayloadTooLargeException, ServiceUnavailableException, UnprocessableEntityException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import type { AntivirusService, ScanResult } from "../../src/storage/antivirus";
import { MAX_UPLOAD_BYTES, StorageService } from "../../src/storage/storage.service";
import type { StorageDriver } from "../../src/storage/storage.types";

/**
 * Ordre du pipeline fichiers (bloc 3, t52u) : taille (413) -> archive ZIP sur metadonnees,
 * sans antivirus (400) -> antivirus sur TOUS les octets (infecte : refuse avant le controle
 * de type) -> delai / saturation (503, rien d'ecrit) -> type reel par magic bytes (400).
 * Faux antivirus et faux stockage : on enregistre l'ordre des appels.
 */
function harness(result: ScanResult) {
  const calls: string[] = [];
  const antivirus = {
    scan: async (content: Buffer) => {
      calls.push(`scan:${content.length}`);
      return result;
    },
  } as unknown as AntivirusService;
  const driver = {
    name: "fake",
    encryption: "test",
    put: async (key: string) => {
      calls.push(`put:${key.split("/")[0]}`);
    },
  } as unknown as StorageDriver;
  return { calls, service: new StorageService(driver, antivirus) };
}

const PDF = Buffer.from("%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n", "latin1");
const clean: ScanResult = { status: "clean", engine: "fake" };

/** Archive ZIP minimale : 1 entree declarant 3 Go decompresses pour 10 octets (bombe). */
function zipBomb(): Buffer {
  const name = Buffer.from("a.bin");
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt32LE(10, 20); // compresse
  central.writeUInt32LE(0xc0000000, 24); // decompresse (~3 Go)
  central.writeUInt16LE(name.length, 28);
  const dir = Buffer.concat([central, name]);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(dir.length, 12);
  eocd.writeUInt32LE(0, 16);
  return Buffer.concat([dir, eocd]);
}

describe("pipeline fichiers : ordre des controles", () => {
  it("fichier vide ou trop gros : refuse avant l'antivirus", async () => {
    const { calls, service } = harness(clean);
    await expect(service.intake("vide.pdf", Buffer.alloc(0))).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.intake("gros.pdf", Buffer.alloc(MAX_UPLOAD_BYTES + 1))).rejects.toBeInstanceOf(PayloadTooLargeException);
    expect(calls).toEqual([]);
  });

  it("bombe ZIP : refusee sur metadonnees, sans appel antivirus ni ecriture", async () => {
    const { calls, service } = harness(clean);
    await expect(service.intake("archive.pdf", zipBomb())).rejects.toBeInstanceOf(BadRequestException);
    expect(calls).toEqual([]);
  });

  it("contenu infecte deguise (mauvais type) : signale infecte, AVANT le controle de type", async () => {
    const { calls, service } = harness({ status: "infected", engine: "fake", signature: "Eicar-Test-Signature" });
    const out = await service.intake("photo.png", Buffer.from("pas une image"));
    expect(out).toMatchObject({ infected: { status: "infected" } });
    expect(calls).toEqual(["scan:13"]);
  });

  it("delai depasse ou scanner sature : 503, rien n'est ecrit", async () => {
    for (const detail of ["scan timeout", "scanner sature"]) {
      const { calls, service } = harness({ status: "error", engine: "fake", detail });
      await expect(service.intake("doc.pdf", PDF)).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(calls).toEqual([`scan:${PDF.length}`]);
    }
  });

  it("contenu sain : antivirus puis type reel ; extension incoherente refusee apres l'antivirus", async () => {
    const ok = harness(clean);
    const out = await ok.service.intake("doc.pdf", PDF);
    expect(out).toMatchObject({ upload: { mimeType: "application/pdf", sizeBytes: PDF.length }, scan: { status: "clean" } });
    expect(ok.calls).toEqual([`scan:${PDF.length}`]);
    const bad = harness(clean);
    await expect(bad.service.intake("doc.png", PDF)).rejects.toBeInstanceOf(BadRequestException);
    expect(bad.calls).toEqual([`scan:${PDF.length}`]);
  });

  it("scanner injoignable : ecrit mais marque error (jamais telechargeable) ; infecte jamais ecrit", async () => {
    const h = harness({ status: "error", engine: "fake", detail: "connexion refusee" });
    const out = await h.service.intake("doc.pdf", PDF);
    if (!("upload" in out)) throw new Error("upload attendu");
    const stored = await h.service.store("ecole-1", out.upload, out.scan);
    expect(stored.scanStatus).toBe("error");
    expect(h.calls).toEqual([`scan:${PDF.length}`, "put:ecole-1"]);
    await expect(h.service.store("ecole-1", out.upload, { status: "infected", engine: "fake" })).rejects.toThrow();
    expect(h.calls).toHaveLength(2);
  });

  it("imports (scanOnly) et exports generes : echec ferme strict", async () => {
    await expect(harness({ status: "infected", engine: "fake" }).service.scanOnly(PDF)).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(harness({ status: "error", engine: "fake" }).service.scanOnly(PDF)).rejects.toBeInstanceOf(ServiceUnavailableException);
    const g = harness({ status: "error", engine: "fake" });
    await expect(g.service.storeGenerated("ecole-1", Buffer.from("{}"), "application/json")).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(g.calls).toEqual(["scan:2"]);
  });
});