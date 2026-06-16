#!/usr/bin/env node
// Minimal zero-dependency static server + /api/usage JSON endpoint.

import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { loadAll, sessionsDir } from "./parse.mjs";
import { aggregate } from "./aggregate.mjs";

// When packaged as a single-file executable (Node SEA), the public/ assets are
// embedded into the binary; otherwise (npm start) they are read from disk.
// In the bundled exe this file is CJS, where `require` exists directly and
// `import.meta.url` is empty; under `npm start` it is ESM. Handle both, and
// guard so older Node without SEA still runs `npm start`.
let sea = null;
try {
  const req = typeof require === "function" ? require : createRequire(import.meta.url);
  sea = req("node:sea");
} catch { /* no SEA available */ }
const IS_SEA = !!(sea && sea.isSea && sea.isSea());

// PUBLIC is only used in on-disk mode; in the exe import.meta.url is empty, so
// guard fileURLToPath to avoid throwing at startup.
let baseDir = ".";
try { baseDir = path.dirname(fileURLToPath(import.meta.url)); } catch { /* SEA: unused */ }
const PUBLIC = path.join(baseDir, "..", "public");
const PORT = Number(process.env.PORT || process.argv[2] || 8787);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, "http://localhost");

    if (u.pathname === "/api/usage") {
      const t0 = Date.now();
      const sessions = await loadAll();
      const account = u.searchParams.get("account"); // null => latest; "all" => mixed
      const data = aggregate(sessions, { account });
      data.machine.hostname = os.hostname();
      data.parseMs = Date.now() - t0;
      res.writeHead(200, { "content-type": MIME[".json"], "cache-control": "no-store" });
      res.end(JSON.stringify(data));
      return;
    }

    let rel = u.pathname === "/" ? "/index.html" : u.pathname;

    // Packaged exe: serve from assets embedded in the binary. getAsset only
    // resolves keys registered at build time, so path traversal is a non-issue.
    if (IS_SEA) {
      const key = path.posix.normalize(rel).replace(/^\/+/, "");
      let buf = null;
      try { buf = sea.getAsset(key); } catch { /* not an embedded asset */ }
      if (buf) {
        res.writeHead(200, { "content-type": MIME[path.extname(key)] || "application/octet-stream" });
        res.end(Buffer.from(buf));
      } else {
        res.writeHead(404);
        res.end("not found");
      }
      return;
    }

    const fp = path.join(PUBLIC, path.normalize(rel).replace(/^(\.\.[\\/])+/, ""));
    if (!fp.startsWith(PUBLIC)) {
      res.writeHead(403);
      res.end("forbidden");
      return;
    }
    if (fs.existsSync(fp) && fs.statSync(fp).isFile()) {
      res.writeHead(200, { "content-type": MIME[path.extname(fp)] || "application/octet-stream" });
      fs.createReadStream(fp).pipe(res);
    } else {
      res.writeHead(404);
      res.end("not found");
    }
  } catch (e) {
    res.writeHead(500);
    res.end("error: " + (e?.message || e));
  }
});

function openBrowser(url) {
  if (process.env.NO_OPEN) return;
  try {
    const p =
      process.platform === "win32"
        ? spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" })
        : process.platform === "darwin"
        ? spawn("open", [url], { detached: true, stdio: "ignore" })
        : spawn("xdg-open", [url], { detached: true, stdio: "ignore" });
    p.unref();
  } catch {
    /* opening the browser is best-effort */
  }
}

// Try PORT; if taken, walk forward a few ports so a double-click never fails.
function listen(port, attemptsLeft) {
  const onError = (e) => {
    if (e.code === "EADDRINUSE" && attemptsLeft > 0) {
      listen(port + 1, attemptsLeft - 1);
    } else {
      console.error("无法启动服务: " + (e?.message || e));
      process.exit(1);
    }
  };
  server.once("error", onError);
  server.listen(port, () => {
    server.removeListener("error", onError);
    const url = `http://localhost:${port}`;
    console.log("");
    console.log(`  Codex usage monitor running -> ${url}`);
    console.log(`  Data source: ${sessionsDir()}`);
    console.log("");
    console.log("  Browser opened. Close this window to stop monitoring.");
    openBrowser(url);
  });
}

listen(PORT, 10);
