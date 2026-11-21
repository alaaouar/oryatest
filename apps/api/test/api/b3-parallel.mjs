#!/usr/bin/env node
/**
 * t52u - envois PARALLELES reels (imports JSON base64 ou justificatifs multipart).
 * Jeton : ORYA_T_TOKEN, base : ORYA_T_BASE (jamais en argument).
 * Usage : node b3-parallel.mjs <import|justif> <n> <csv|pdf|zipbomb> [studentId]
 * Sortie : une ligne JSON { statuses:[...], ms:[...], messages:[...] }.
 */
import JSZip from "jszip";
const [kind, nRaw, gen, studentId] = process.argv.slice(2);
const n = Number(nRaw);
const base = process.env.ORYA_T_BASE;
const auth = { Authorization: `Bearer ${process.env.ORYA_T_TOKEN}` };

async function bomb() {
  const z = new JSZip();
  z.file("[Content_Types].xml", "<Types/>");
  z.file("xl/worksheets/sheet1.xml", Buffer.alloc(60 * 1024 * 1024, 0));
  return z.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
async function body(i) {
  if (gen === "zipbomb") return bomb();
  if (gen === "csv") return Buffer.from(`code eleve;nom;classe\nEXP${String(i).padStart(3, "0")};Parallele;B3-6A\n`, "utf8");
  return Buffer.from(`%PDF-1.4\n% ORYA-EX-${i}\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n`, "latin1");
}
async function one(i, content) {
  const t0 = Date.now();
  let res;
  if (kind === "import") {
    const filename = gen === "zipbomb" ? "bombe.xlsx" : `parallele-${i}.csv`;
    res = await fetch(`${base}/imports`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ filename, contentBase64: content.toString("base64"), schoolYear: "2026-2027" }),
    });
  } else {
    const form = new FormData();
    const day = String(10 + (i % 18)).padStart(2, "0");
    form.append("studentId", studentId);
    form.append("fromDate", `2026-11-${day}`);
    form.append("toDate", `2026-11-${day}`);
    form.append("reason", `Parallele EX ${i}`);
    form.append("file", new Blob([content], { type: "application/pdf" }), gen === "zipbomb" ? "bombe.pdf" : `piece-${i}.pdf`);
    res = await fetch(`${base}/family/justifications`, { method: "POST", headers: auth, body: form });
  }
  const text = await res.text();
  let message = "";
  try { message = String(JSON.parse(text).message ?? "").slice(0, 160); } catch { message = text.slice(0, 160); }
  return { status: res.status, ms: Date.now() - t0, message };
}
const contents = await Promise.all(Array.from({ length: n }, (_, i) => body(i)));
const out = await Promise.all(contents.map((c, i) => one(i, c).catch((e) => ({ status: 0, ms: 0, message: String(e?.message ?? e).slice(0, 120) }))));
process.stdout.write(JSON.stringify({ statuses: out.map((o) => o.status), ms: out.map((o) => o.ms), messages: out.map((o) => o.message) }) + "\n");