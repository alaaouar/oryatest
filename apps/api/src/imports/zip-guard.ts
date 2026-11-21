/**
 * Contrôle des fichiers .xlsx avant décompression (protection « archive piégée »).
 *
 * exceljs décompresse via jszip : sans garde-fou, un fichier de 5 Mo peut
 * produire des gigabytes en mémoire (zip bomb). On lit donc le répertoire
 * central du ZIP *avant* de le confier à exceljs et on refuse :
 *   - un nombre d'entrées excessif ;
 *   - une taille décompressée totale excessive ;
 *   - un ratio de compression anormal ;
 *   - des chemins absurdes (zip slip) ;
 *   - un fichier qui n'est pas un classeur OOXML ([Content_Types].xml absent).
 */
export type ZipGuardResult = { ok: true } | { ok: false; reason: string };

const MAX_ENTRIES = 200;
const MAX_TOTAL_UNCOMPRESSED = 50 * 1024 * 1024; // 50 Mo
const MAX_RATIO = 100;

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;

export function isXlsx(buffer: Buffer): boolean {
  return (
    buffer.length > 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    (buffer[2] === 0x03 || buffer[2] === 0x05) &&
    (buffer[3] === 0x04 || buffer[3] === 0x06)
  );
}

/**
 * t52u : detection d'une archive ZIP par ses seules metadonnees, sans decompression
 * et quel que soit le nom annonce : signature locale en tete, ou fin de repertoire
 * central pointant vers une entree centrale valide (archive precedee d'octets).
 */
export function looksLikeZip(buffer: Buffer): boolean {
  if (isXlsx(buffer)) return true;
  const eocd = findEndOfCentralDirectory(buffer);
  if (eocd < 0) return false;
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  return centralOffset + 4 <= buffer.length && buffer.readUInt32LE(centralOffset) === CENTRAL_SIGNATURE;
}

/**
 * Controle du repertoire central uniquement (aucune decompression) : nombre d'entrees,
 * taille decompressee declaree, ratio, chemins. `requireOoxml` (defaut : oui) exige en
 * plus [Content_Types].xml (classeur .xlsx) ; non pour une archive quelconque.
 */
export function inspectZip(buffer: Buffer, options: { requireOoxml?: boolean } = {}): ZipGuardResult {
  const requireOoxml = options.requireOoxml !== false;
  const eocd = findEndOfCentralDirectory(buffer);

  if (eocd < 0) {
    return { ok: false, reason: "archive ZIP illisible (répertoire central absent)" };
  }

  const entryCount = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);

  if (entryCount === 0 || entryCount > MAX_ENTRIES) {
    return { ok: false, reason: `nombre d'entrées ZIP anormal (${entryCount})` };
  }

  if (centralOffset + centralSize > buffer.length) {
    return { ok: false, reason: "répertoire central hors des limites du fichier" };
  }

  let totalUncompressed = 0;
  let totalCompressed = 0;
  let hasContentTypes = false;
  let offset = centralOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
      return { ok: false, reason: "entrée ZIP invalide" };
    }

    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);

    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;

    if (nameEnd > buffer.length) {
      return { ok: false, reason: "nom d'entrée ZIP hors limites" };
    }

    const entryName = buffer.toString("utf8", nameStart, nameEnd);
    const normalised = entryName.replace(/\\/g, "/");

    if (normalised.startsWith("/") || normalised.split("/").includes("..")) {
      return { ok: false, reason: "chemin d'entrée ZIP interdit" };
    }

    if (normalised === "[Content_Types].xml") {
      hasContentTypes = true;
    }

    totalCompressed += compressedSize;
    totalUncompressed += uncompressedSize;

    if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED) {
      return { ok: false, reason: "fichier compressé trop volumineux une fois décompressé" };
    }

    offset = nameEnd + extraLength + commentLength;
  }

  if (requireOoxml && !hasContentTypes) {
    return { ok: false, reason: "fichier .xlsx invalide ([Content_Types].xml absent)" };
  }

  if (totalCompressed > 0 && totalUncompressed / totalCompressed > MAX_RATIO) {
    return {
      ok: false,
      reason: `ratio de compression anormal (${Math.round(totalUncompressed / totalCompressed)}:1)`,
    };
  }

  return { ok: true };
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  if (buffer.length < 22) return -1;
  const minimum = Math.max(0, buffer.length - 65_557);

  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) {
      return offset;
    }
  }

  return -1;
}
