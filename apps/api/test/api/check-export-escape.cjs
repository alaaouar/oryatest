// Lot 7 : vérifie l'échappement anti-formule des exports (code compilé dist/).
const path = require("node:path");
const { toCsv, escapeCell } = require(path.join(__dirname, "..", "..", "dist", "dashboard", "export.js"));
const csv = toCsv({ title: "t", columns: ["a"], rows: [["=HYPERLINK(1)"], ["+1"], ["-2"], ["@x"], ["\tz"], ["ok"], [5]] }).toString("utf8");
const ok =
  csv.includes("'=HYPERLINK(1)") && csv.includes("'+1") && csv.includes("'-2") && csv.includes("'@x") &&
  !/(^|\n)[=+\-@]/.test(csv.replace(/^\uFEFF/, "")) && escapeCell(5) === 5 && escapeCell("ok") === "ok";
process.stdout.write(ok ? "OK" : "KO");
