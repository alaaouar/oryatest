// Bloc 5 : emissions concurrentes (Promise.all). Jeton lu dans ORYA_T_TOKEN, jamais affiche.
// Usage : node test/api/b5-parallel.mjs <schoolId>... ; sortie JSON {statuses, numbers}.
const base = process.env.ORYA_T_BASE;
const token = process.env.ORYA_T_TOKEN;
const ids = process.argv.slice(2);
const results = await Promise.all(
  ids.map(async (id) => {
    const r = await fetch(`${base}/admin/billing/schools/${id}/invoices`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ schoolYear: "2026-2027" }),
    });
    const body = await r.json().catch(() => ({}));
    return { status: r.status, number: body?.invoice?.number ?? null };
  }),
);
process.stdout.write(JSON.stringify({ statuses: results.map((r) => r.status), numbers: results.map((r) => r.number).filter(Boolean) }));