#!/usr/bin/env node
/**
 * Bloc 4 - lecture d'une URL pre-signee (dans ORYA_T_URL, jamais en argument).
 * Sortie : { status, expires, disposition, length, head, text } ; text seulement si JSON.
 */
const url = process.env.ORYA_T_URL;
const res = await fetch(url);
const buf = Buffer.from(await res.arrayBuffer());
const u = new URL(url);
const isJson = (res.headers.get("content-type") ?? "").includes("json");
process.stdout.write(
  JSON.stringify({
    status: res.status,
    expires: Number(u.searchParams.get("X-Amz-Expires") ?? 0),
    disposition: res.headers.get("content-disposition") ?? "",
    length: buf.length,
    head: buf.subarray(0, 8).toString("latin1"),
    text: isJson && res.status === 200 ? buf.toString("utf8") : "",
  }) + "\n",
);