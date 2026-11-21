#!/usr/bin/env node
/**
 * Bloc 3 - envoi multipart REEL (FormData, traite par multer cote API).
 * Jeton lu dans ORYA_T_TOKEN, base dans ORYA_T_BASE (jamais en argument).
 * Usage : node b3-upload.mjs <path> <gen> <filename> <declaredMime> [k=v ...]
 *   gen : pdf | png | jpg | heic | exe | eicar | big | b64 (ORYA_T_B64) | none
 *   champ fichier : ORYA_T_FILEFIELD (defaut "file")
 * Le contenu EICAR est construit en memoire (jamais ecrit sur disque).
 * Sortie : une ligne JSON { status, body, sha256 }.
 */
import { createHash } from "node:crypto";

const [path, gen, filename, mime, ...kv] = process.argv.slice(2);
const marker = process.env.ORYA_T_MARKER ?? "ORYA-B3";

function eicar() {
  // Chaine de test antivirus standard EICAR, assemblee a l'execution.
  const parts = ["X5O!P%@AP[4\\PZX54(P^)7CC)7}$", "EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$", "H+H*"];
  return Buffer.from(parts.join(""), "latin1");
}

function content(kind) {
  switch (kind) {
    case "pdf": return Buffer.from(`%PDF-1.4\n% ${marker}\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n`, "latin1");
    case "png": return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`IHDR ${marker}`, "latin1")]);
    case "jpg": return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`JFIF ${marker}`, "latin1")]);
    case "heic": return Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x18]), Buffer.from("ftypheic", "latin1"), Buffer.from([0, 0, 0, 0]), Buffer.from(`mif1heic ${marker}`, "latin1")]);
    case "exe": return Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00]);
    case "eicar": return eicar();
    case "pdfeicar": return Buffer.concat([Buffer.from("%PDF-1.4\n", "latin1"), eicar()]);
    case "b64": return Buffer.from(process.env.ORYA_T_B64 ?? "", "base64");
    case "big": { const b = Buffer.alloc(10 * 1024 * 1024 + 1, 0x20); b.write("%PDF-1.4\n", 0, "latin1"); return b; }
    default: return null;
  }
}

const form = new FormData();
for (const pair of kv) {
  const i = pair.indexOf("=");
  form.append(pair.slice(0, i), pair.slice(i + 1));
}
const buf = content(gen);
if (buf) form.append(process.env.ORYA_T_FILEFIELD || "file", new Blob([buf], { type: mime }), filename);
const res = await fetch(`${process.env.ORYA_T_BASE}${path}`, {
  method: "POST",
  headers: { Authorization: `Bearer ${process.env.ORYA_T_TOKEN}` },
  body: form,
});
const text = await res.text();
let body;
try { body = JSON.parse(text); } catch { body = text.slice(0, 200); }
process.stdout.write(JSON.stringify({ status: res.status, body, sha256: buf ? createHash("sha256").update(buf).digest("hex") : null }) + "\n");