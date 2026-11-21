#!/usr/bin/env node
/** Fixture t51u : clamd accepte le TCP mais ne repond jamais (timeout deterministe). Test seulement. */
import net from "node:net";
const sockets = new Set();
// t52u (F11T) : allowHalfOpen obligatoire. Sans lui, Node ferme automatiquement la socket
// quand le client termine son envoi INSTREAM (FIN) : le client recoit alors une reponse VIDE
// ("reponse inattendue", 9 ms) au lieu d'un silence, et le timeout n'est jamais exerce.
const server = net.createServer({ allowHalfOpen: true }, (s) => {
  sockets.add(s);
  s.on("data", () => {});
  s.on("error", () => {});
  s.on("close", () => sockets.delete(s));
});
server.on("error", () => process.exit(1));
server.listen(55437, "127.0.0.1", () => console.log("SILENT_CLAMD_READY"));
function stop() { for (const s of sockets) s.destroy(); server.close(() => process.exit(0)); }
process.on("SIGTERM", stop);
process.on("SIGINT", stop);