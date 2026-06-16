#!/usr/bin/env node
// Codex Export Receiver — zero-dependency HTTP server.
// Receives gzipped export files, stores them, provides a web UI to list & download.
//
//   node receiver.mjs                     → default port 18900
//   PORT=9000 node receiver.mjs           → custom port
//   DATA_DIR=/tmp node receiver.mjs       → custom data directory
"use strict";

import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 18900;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "exported-data");
const API_KEY = process.env.API_KEY || "codex-cal-2026";
// If behind a reverse-proxy path prefix (e.g. /codex-export), set BASE_PATH
const BASE_PATH = (process.env.BASE_PATH || "").replace(/\/+$/, "");

fs.mkdirSync(DATA_DIR, { recursive: true });

// ===== helpers =====
function parseAuth(req) {
  const m = (req.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

function ts() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

function log(msg) {
  console.log(`[${ts()}] ${msg}`);
}

// ===== handlers =====
function handleUpload(req, res) {
  const token = parseAuth(req);
  if (token !== API_KEY) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden: invalid API key");
    log("Upload rejected: bad API key");
    return;
  }

  const machineId = (req.headers["x-machine-id"] || "unknown").slice(0, 16).replace(/[^a-zA-Z0-9_-]/g, "_");
  const dateStr = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `codex-export-${machineId}-${dateStr}.json.gz`;
  const filePath = path.join(DATA_DIR, filename);

  let bytes = 0;
  const ws = fs.createWriteStream(filePath);

  req.on("data", (chunk) => {
    bytes += chunk.length;
    ws.write(chunk);
  });

  req.on("end", () => {
    ws.end();
    const kb = (fs.statSync(filePath).size / 1024).toFixed(1);
    log(`Received: ${filename} (${kb} KB) from ${machineId}`);
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(`OK: ${filename} (${kb} KB stored)`);
  });

  req.on("error", (e) => {
    ws.close();
    try { fs.unlinkSync(filePath); } catch {}
    log(`Upload error: ${e.message}`);
    if (!res.headersSent) {
      res.writeHead(500);
      res.end("Upload failed");
    }
  });
}

function serveIndex(res) {
  const files = fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.endsWith(".json.gz"))
    .map((f) => {
      const st = fs.statSync(path.join(DATA_DIR, f));
      return { name: f, size: st.size, mtime: st.mtime };
    })
    .sort((a, b) => b.mtime - a.mtime);

  const fmtSize = (b) => (b >= 1e6 ? (b / 1e6).toFixed(1) + " MB" : (b / 1e3).toFixed(1) + " KB");

  const B = BASE_PATH; // shorthand for HTML template
  const html = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Codex Export Receiver</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, -apple-system, sans-serif; max-width: 900px; margin: 2em auto; padding: 0 1.5em; background: #fafafa; color: #222; }
  h1 { font-size: 1.5em; margin-bottom: 0.3em; }
  .sub { color: #666; margin-bottom: 1.5em; font-size: 0.9em; }
  table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
  th, td { padding: 10px 16px; text-align: left; border-bottom: 1px solid #eee; font-size: 0.9em; }
  th { background: #f5f5f5; font-weight: 600; color: #555; }
  tr:hover { background: #f9f9f9; }
  .empty { text-align: center; color: #999; padding: 3em 0; }
  a { color: #2563eb; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .size { text-align: right; font-variant-numeric: tabular-nums; }
  .badge { display:inline-block; padding:2px 8px; border-radius:12px; font-size:0.75em; background:#e8f5e9; color:#2e7d32; margin-left:6px; }
</style>
</head>
<body>
<h1>📊 Codex Export Receiver</h1>
<p class="sub">
  ${files.length} export(s) received
  <span class="badge">${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })} CST</span>
</p>
${
  files.length === 0
    ? '<p class="empty">No exports yet. Run <code>export-send.cmd</code> on a machine with Codex usage.</p>'
    : `<table>
<tr><th>File</th><th>Size</th><th>Received</th><th></th></tr>
${files
  .map(
    (f) => `<tr>
  <td><code>${f.name}</code></td>
  <td class="size">${fmtSize(f.size)}</td>
  <td>${f.mtime.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</td>
  <td><a href="${B}/download/${encodeURIComponent(f.name)}">⬇ Download</a></td>
</tr>`
  )
  .join("")}
</table>`
}
<p style="margin-top:2em;color:#999;font-size:0.8em;">
  Receiver v1 · port ${PORT} · data: ${DATA_DIR}
</p>
</body>
</html>`;

  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

function serveDownload(url, res) {
  const filename = path.basename(decodeURIComponent(url.slice("/download/".length)));
  if (!filename.endsWith(".json.gz")) {
    res.writeHead(400);
    res.end("Bad filename");
    return;
  }
  const fp = path.join(DATA_DIR, filename);
  if (!fs.existsSync(fp)) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  res.writeHead(200, {
    "Content-Type": "application/octet-stream",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Content-Length": fs.statSync(fp).size,
  });
  fs.createReadStream(fp).pipe(res);
}

// ===== server =====
// Strip BASE_PATH prefix from incoming URLs so routes work behind a reverse proxy.
function stripBase(url) {
  if (BASE_PATH && url.startsWith(BASE_PATH + "/")) return url.slice(BASE_PATH.length);
  if (BASE_PATH && url === BASE_PATH) return "/";
  return url;
}

const server = http.createServer((req, res) => {
  const url = stripBase(req.url);
  if (req.method === "POST" && url === "/upload") handleUpload(req, res);
  else if (req.method === "GET" && url === "/") serveIndex(res);
  else if (req.method === "GET" && url.startsWith("/download/")) serveDownload(url, res);
  else if (req.method === "GET" && url === "/health") { res.writeHead(200); res.end("OK"); }
  else { res.writeHead(404, { "Content-Type": "text/plain" }); res.end("Not found"); }
});

server.listen(PORT, "0.0.0.0", () => {
  log(`Receiver started on :${PORT}`);
  log(`Data directory: ${DATA_DIR}`);
  log(`Web UI: http://localhost:${PORT}/`);
});
