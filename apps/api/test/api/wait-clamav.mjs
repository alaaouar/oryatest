#!/usr/bin/env node
/** t51u : readiness clamd TCP (meme canal que INSTREAM), jamais simple health HTTP. */
import net from "node:net";
const arg = process.argv.find((a) => a.startsWith("--timeout-ms="));
const raw = Number(arg?.split("=")[1] ?? 120000);
const timeout = Number.isFinite(raw) ? Math.max(1000, Math.min(600000, raw)) : 120000;
const deadline = Date.now() + timeout;
function query(command) {
  return new Promise((resolve) => {
    let result = "";
    const socket = new net.Socket();
    const timer = setTimeout(() => { socket.destroy(); resolve(""); }, Math.max(1, Math.min(2000, deadline - Date.now())));
    const end = () => { clearTimeout(timer); socket.destroy(); resolve(result.replace(/\0/g, "").trim()); };
    socket.on("error", end);
    socket.on("data", (d) => { result += d.toString(); if (result.includes("\0") || result.includes("\n")) end(); });
    socket.on("end", end);
    socket.connect(55436, "127.0.0.1", () => socket.write(`z${command}\0`));
  });
}
let ready = false;
while (Date.now() < deadline) {
  if (await query("PING") === "PONG") {
    const version = await query("VERSION");
    if (/^ClamAV \S+/.test(version)) { console.log(`ClamAV pret : PONG ; ${version}`); ready = true; break; }
  }
  if (Date.now() < deadline) await new Promise((r) => setTimeout(r, Math.min(500, deadline - Date.now())));
}
if (!ready) { console.error("ClamAV non prêt : PING/PONG et VERSION requis, delai maximal depasse."); process.exitCode = 78; }
// Rechauffage : la 1re analyse d'un en-tete PE (MZ) compile le moteur bytecode de clamd
// (~3 s a vide, bien plus sous la charge de verify-all). Si elle depasse MaxScanTime, clamd
// repond Heuristics.Limits.Exceeded.MaxScanTime (FOUND) et les tests "executable refuse
// (400)" recoivent 422. On la fait ici, une fois, avant les suites ; aucune assertion changee.
function instream(buf) {
  return new Promise((resolve) => {
    let result = "";
    const socket = new net.Socket();
    const timer = setTimeout(() => { socket.destroy(); resolve("timeout"); }, Math.max(1000, deadline - Date.now()));
    socket.on("error", () => { clearTimeout(timer); resolve("erreur"); });
    socket.on("data", (d) => { result += d.toString(); });
    socket.on("close", () => { clearTimeout(timer); resolve(result.replace(/\0/g, "").trim()); });
    socket.connect(55436, "127.0.0.1", () => {
      socket.write("zINSTREAM\0");
      const len = Buffer.alloc(4); len.writeUInt32BE(buf.length, 0);
      socket.write(len); socket.write(buf); socket.end(Buffer.alloc(4));
    });
  });
}
if (ready) {
  const pe = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00]);
  let warmed = false;
  for (let i = 0; i < 3 && !warmed && Date.now() < deadline; i++) {
    const t0 = Date.now();
    const reply = await instream(pe);
    console.log(`ClamAV rechauffage PE ${i + 1} : ${reply} (${Date.now() - t0} ms)`);
    warmed = reply === "stream: OK";
  }
  if (!warmed) { console.error("ClamAV non prêt : rechauffage du moteur (en-tete PE) en echec."); process.exitCode = 78; }
}