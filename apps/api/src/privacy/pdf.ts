/**
 * Generateur PDF minimal (texte, Helvetica, A4), sans dependance. Le texte est
 * reduit a l'ASCII imprimable : les accents sont retires, les autres caracteres
 * remplaces par "?" (le JSON reste la version complete et fidele).
 */
function ascii(line: string): string {
  return line
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e]/g, "?")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function wrap(line: string, width = 95): string[] {
  if (line.length <= width) return [line];
  const out: string[] = [];
  for (let i = 0; i < line.length; i += width) out.push(line.slice(i, i + width));
  return out;
}

export function renderTextPdf(title: string, lines: string[]): Buffer {
  const all = [title, "", ...lines].flatMap((l) => wrap(ascii(l)));
  const perPage = 60;
  const pages: string[][] = [];
  for (let i = 0; i < all.length; i += perPage) pages.push(all.slice(i, i + perPage));
  if (pages.length === 0) pages.push([""]);

  const objects: string[] = [];
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  const kids: string[] = [];
  pages.forEach((page, index) => {
    const pageId = 4 + index * 2;
    const contentId = pageId + 1;
    kids.push(`${pageId} 0 R`);
    const body = ["BT", "/F1 9 Tf", "12 TL", "40 800 Td", ...page.map((l) => `(${l}) '`), "ET"].join("\n");
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${Buffer.byteLength(body, "latin1")} >>\nstream\n${body}\nendstream`;
  });
  objects[2] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages.length} >>`;

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = Buffer.byteLength(out, "latin1");
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) out += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}