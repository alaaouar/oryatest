import ExcelJS from "exceljs";

export type Table = { title: string; columns: string[]; rows: (string | number | null)[][] };

/**
 * Neutralise l'injection de formules (CSV/XLSX ouverts dans un tableur) :
 * toute chaîne commençant par = + - @ tabulation ou retour chariot est
 * préfixée d'une apostrophe. Les nombres restent des nombres.
 */
export function escapeCell(value: string | number | null): string | number {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return value;
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function csvField(value: string | number): string {
  const text = String(value);
  return /[",;\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** CSV UTF-8 avec BOM (accents lisibles dans Excel), séparateur point-virgule (Excel FR). */
export function toCsv(table: Table): Buffer {
  const lines = [table.columns, ...table.rows].map((row) => row.map((cell) => csvField(escapeCell(cell))).join(";"));
  return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(lines.join("\r\n") + "\r\n", "utf8")]);
}

export async function toXlsx(table: Table, notice?: string[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ORYA";
  const sheet = workbook.addWorksheet(table.title.slice(0, 31));
  sheet.addRow(table.columns).font = { bold: true };
  for (const row of table.rows) {
    // Valeurs écrites comme données : aucune cellule n'est une formule.
    sheet.addRow(row.map((cell) => escapeCell(cell)));
  }
  sheet.columns.forEach((column) => {
    column.width = 22;
  });
  if (notice?.length) {
    const info = workbook.addWorksheet("A lire");
    for (const line of notice) info.addRow([escapeCell(line)]);
    info.getColumn(1).width = 110;
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
