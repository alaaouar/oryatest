import type { AcceptedMime } from "./storage.types";

/** Marques ISO-BMFF des images HEIF/HEIC (boite ftyp, octets 8 a 11). */
const HEIF_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"]);

/**
 * Type reel deduit des premiers octets (magic bytes). L'extension et le type
 * declares par le client (MIME multer compris) ne suffisent jamais.
 */
export function detectMime(content: Buffer): AcceptedMime | null {
  if (content.length >= 5 && content.subarray(0, 5).toString("latin1") === "%PDF-") {
    return "application/pdf";
  }
  if (content.length >= 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff) {
    return "image/jpeg";
  }
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (content.length >= png.length && png.every((byte, index) => content[index] === byte)) {
    return "image/png";
  }
  if (
    content.length >= 12 &&
    content.subarray(4, 8).toString("latin1") === "ftyp" &&
    HEIF_BRANDS.has(content.subarray(8, 12).toString("latin1"))
  ) {
    return "image/heic";
  }
  return null;
}

const EXTENSIONS: Record<AcceptedMime, string[]> = {
  "application/pdf": [".pdf"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/heic": [".heic", ".heif"],
};

export function extensionMatches(filename: string, mime: AcceptedMime): boolean {
  const lower = filename.toLowerCase();
  return EXTENSIONS[mime].some((extension) => lower.endsWith(extension));
}