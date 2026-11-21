#!/usr/bin/env node
/**
 * t52u - MESURE (rapport) : duree d'analyse ClamAV d'un fichier legitime de 10 Mo
 * (PDF texte deterministe) via le client compile de l'API. CLAMAV_HOST / CLAMAV_PORT.
 * Sortie : une ligne JSON { bytes, status, runs:[ms...], medianMs }.
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { AntivirusService } = require("../../dist/storage/antivirus.js");
const size = 10 * 1000 * 1000;
const head = Buffer.from("%PDF-1.4\n1 0 obj<< /Length 0 >>stream\n", "latin1");
const tail = Buffer.from("\nendstream endobj\ntrailer<<>>\n%%EOF\n", "latin1");
const body = Buffer.alloc(size - head.length - tail.length);
let x = 2463534242;
const words = ["eleve", "classe", "absence", "justificatif", "parent", "ecole", "rentree", "cahier", "devoir", "lundi"];
for (let i = 0; i < body.length; ) {
  x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
  const w = words[x % words.length] + (x % 7 === 0 ? "\n" : " ");
  i += body.write(w, i, "latin1");
}
const content = Buffer.concat([head, body, tail]);
const av = new AntivirusService();
const runs = []; let status = "";
for (let r = 0; r < 3; r += 1) {
  const t0 = Date.now();
  const res = await av.scan(content);
  runs.push(Date.now() - t0); status = res.status + (res.signature ? ":" + res.signature : "") + (res.detail ? ":" + res.detail : "");
}
const sorted = [...runs].sort((a, b) => a - b);
process.stdout.write(JSON.stringify({ bytes: content.length, status, runs, medianMs: sorted[1] }) + "\n");