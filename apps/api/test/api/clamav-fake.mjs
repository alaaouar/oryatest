#!/usr/bin/env node
/**
 * Fixture t52u : faux clamd ESPION pour les tests d'epuisement (test seulement).
 * Usage : node clamav-fake.mjs <port> <delaiMs> <fichierStats>
 * Repond "stream: OK" <delaiMs> apres la fin du flux INSTREAM. Compte les connexions
 * (total), les analyses simultanees (active) et leur maximum (max), ecrits en JSON
 * dans <fichierStats> a chaque changement. allowHalfOpen : la reponse part apres le FIN client.
 */
import net from "node:net";
import { writeFileSync } from "node:fs";
const [port, delay, statsFile] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4]];
const stats = { total: 0, active: 0, max: 0 };
const sockets = new Set();
const save = () => writeFileSync(statsFile, JSON.stringify(stats));
save();
const server = net.createServer({ allowHalfOpen: true }, (s) => {
  sockets.add(s);
  stats.total += 1; stats.active += 1; stats.max = Math.max(stats.max, stats.active); save();
  let closed = false;
  const done = () => { if (closed) return; closed = true; stats.active -= 1; save(); sockets.delete(s); };
  s.on("data", () => {});
  s.on("error", done);
  s.on("close", done);
  s.on("end", () => setTimeout(() => { if (!closed) s.end("stream: OK\0"); }, delay));
});
server.on("error", () => process.exit(1));
server.listen(port, "127.0.0.1", () => console.log("FAKE_CLAMD_READY"));
function stop() { for (const s of sockets) s.destroy(); server.close(() => process.exit(0)); }
process.on("SIGTERM", stop);
process.on("SIGINT", stop);