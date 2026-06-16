#!/usr/bin/env node
// Codex Usage Export — standalone, zero-dependency.
// Scans ~/.codex/sessions/**/*.jsonl, extracts token_count + session_meta,
// gzips, and POSTs to a receiver server.
//
// Double-click export-send.cmd (Windows) or export-send.command (macOS), or:
//   node export-send.mjs                    → upload to default receiver
//   node export-send.mjs --local            → save to Desktop, skip upload
//   node export-send.mjs --server=1.2.3.4   → upload to custom receiver
"use strict";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import zlib from "node:zlib";
import https from "node:https";
import { execSync } from "node:child_process";

// ===== config =====
const RECEIVER_URL = "https://47.122.119.25/codex-export";
const API_KEY = "codex-cal-2026";

const C = { reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m", green: "\x1b[32m", yellow: "\x1b[33m", red: "\x1b[31m", cyan: "\x1b[36m" };

// ===== args =====
const ARG_LOCAL = process.argv.includes("--local");
const serverArg = process.argv.find((a) => a.startsWith("--server="));
const UPLOAD_URL = serverArg ? serverArg.split("=")[1] : RECEIVER_URL;

function stamp() { return `${C.dim}[${new Date().toLocaleTimeString()}]${C.reset}`; }

// ===== paths =====
function codexHome() {
  return process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
}
function sessionsDir() {
  return process.env.CODEX_SESSIONS_DIR || path.join(codexHome(), "sessions");
}
function listSessionFiles(dir) {
  const out = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listSessionFiles(p));
    else if (e.isFile() && e.name.endsWith(".jsonl")) out.push(p);
  }
  return out;
}

// ===== parse (standalone copy of parse.mjs core, so this script is self-contained) =====
async function parseSessionFile(file) {
  const rl = readline.createInterface({
    input: fs.createReadStream(file, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  let meta = null;
  const events = [];
  for await (const line of rl) {
    if (!line) continue;
    const wantMeta = !meta && line.includes('"session_meta"');
    const wantTok = line.includes('"token_count"');
    if (!wantMeta && !wantTok) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    const p = o?.payload;
    if (!p) continue;
    if (o.type === "session_meta" && !meta) {
      meta = {
        id: p.id ?? null,
        cwd: p.cwd ?? null,
        cliVersion: p.cli_version ?? null,
        source: p.source ?? null,
        provider: p.model_provider ?? null,
        startedAt: p.timestamp ?? o.timestamp ?? null,
      };
    } else if (p.type === "token_count") {
      const ev = { ts: o.timestamp ?? null };
      const L = p.info?.last_token_usage;
      if (L) {
        ev.input = L.input_tokens || 0;
        ev.cached = L.cached_input_tokens || 0;
        ev.output = L.output_tokens || 0;
        ev.reasoning = L.reasoning_output_tokens || 0;
        ev.total = L.total_tokens || 0;
      }
      const r = p.rate_limits;
      if (r) {
        const win = (w) =>
          w
            ? { usedPercent: w.used_percent ?? null, windowMinutes: w.window_minutes ?? null, resetsAt: w.resets_at ?? null }
            : null;
        ev.rate = {
          limitName: r.limit_name || r.limit_id || null,
          planType: r.plan_type ?? null,
          primary: win(r.primary),
          secondary: win(r.secondary),
        };
      }
      events.push(ev);
    }
  }
  let account = null;
  for (const ev of events) {
    if (ev.rate?.planType) account = ev.rate.planType;
  }
  return { meta, events, account };
}

// ===== upload =====
function upload(buffer, machineId, host, user) {
  return new Promise((resolve, reject) => {
    const u = new URL(UPLOAD_URL);
    const req = https.request(
      {
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname.replace(/\/$/, "") + "/upload",
        method: "POST",
        rejectUnauthorized: false,
        headers: {
          ...(u.hostname.match(/^\d+\.\d+\.\d+\.\d+$/) ? { Host: u.hostname } : {}),
          "Content-Type": "application/octet-stream",
          Authorization: `Bearer ${API_KEY}`,
          "X-Machine-Id": machineId || "unknown",
          "X-Hostname": host || "unknown",
          "X-Username": user || "unknown",
          "Content-Length": buffer.length,
        },
        timeout: 120_000,
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          if (res.statusCode === 200) resolve(body.trim());
          else reject(new Error(`HTTP ${res.statusCode}: ${body.trim()}`));
        });
      }
    );
    req.on("timeout", () => { req.destroy(); reject(new Error("Upload timed out (2 min)")); });
    req.on("error", reject);
    req.write(buffer);
    req.end();
  });
}

// ===== main =====
const [machineId, host, user] = (() => {
  let id, h, u;
  try { id = fs.readFileSync(path.join(codexHome(), "installation_id"), "utf8").trim().slice(0, 12); } catch { id = "unknown"; }
  try { h = os.hostname().replace(/[^a-zA-Z0-9_-]/g, "_"); } catch { h = "unknown"; }
  try { u = os.userInfo().username.replace(/[^a-zA-Z0-9_-]/g, "_"); } catch { u = "unknown"; }
  return [id, h, u];
})();

// Try to find the user's Desktop directory in a cross-platform way.
function desktopDir() {
  if (process.platform === "win32") {
    return path.join(os.homedir(), "Desktop");
  }
  // macOS / Linux: "Desktop" is the default, but localized systems may differ.
  // Use osascript on macOS to get the real Desktop path when possible.
  if (process.platform === "darwin") {
    try {
      const p = execSync("osascript -e 'POSIX path of (path to desktop folder)'", { encoding: "utf8", timeout: 5000 }).trim();
      if (p) return p;
    } catch {}
  }
  return path.join(os.homedir(), "Desktop");
}

async function main() {
  console.log("");
  console.log(`  ${C.bold}Codex Usage Export${C.reset}`);
  console.log(`  Machine : ${host}  (${machineId})`);
  console.log(`  User    : ${user}`);
  if (ARG_LOCAL) console.log(`  Mode    : ${C.yellow}Local only${C.reset} (save to Desktop)`);
  else console.log(`  Target  : ${UPLOAD_URL}`);
  console.log("");

  // 1. Scan
  console.log(`${stamp()} ${C.cyan}Scanning${C.reset} session files...`);
  const files = listSessionFiles();
  if (files.length === 0) {
    console.log(`\n  ${C.red}No .jsonl session files found under ${sessionsDir()}${C.reset}`);
    console.log(`  Nothing to export. Have you used Codex on this machine?\n`);
    process.exit(1);
  }
  const totalSize = files.reduce((s, f) => { try { return s + fs.statSync(f).size; } catch { return s; } }, 0);
  console.log(`${stamp()} Found ${files.length} file(s), ${(totalSize / 1024 / 1024).toFixed(1)} MB raw`);

  // 2. Parse
  const sessions = [];
  let totalEvents = 0,
    errors = 0;
  const sd = sessionsDir();
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const rel = path.relative(sd, f);
    try {
      // Show file basename and progress
      const pct = files.length > 1 ? ` [${i + 1}/${files.length}]` : "";
      process.stdout.write(`\r${stamp()} Parsing${pct} ${path.basename(f)}...`);
      const s = await parseSessionFile(f);
      sessions.push({ file: rel, ...s });
      totalEvents += s.events.length;
    } catch (e) {
      errors++;
      console.log(`\n${stamp()} ${C.yellow}Skip${C.reset} ${rel}: ${e.message}`);
    }
  }
  process.stdout.write("\r" + " ".repeat(80) + "\r"); // clear the progress line
  console.log(`${stamp()} ${C.green}Parsed${C.reset} ${sessions.length} sessions, ${totalEvents} token_count events${errors ? ` (${errors} skipped)` : ""}`);

  if (totalEvents === 0) {
    console.log(`\n  ${C.yellow}No token_count events found. Nothing useful to export.${C.reset}\n`);
    process.exit(0);
  }

  // 3. Build export object
  const exportData = {
    version: 1,
    exportedAt: new Date().toISOString(),
    hostname: host,
    installationId: machineId,
    username: user,
    sessions,
  };
  const raw = JSON.stringify(exportData);

  // 4. Gzip
  process.stdout.write(`${stamp()} Compressing ${(raw.length / 1024 / 1024).toFixed(1)} MB...`);
  const compressed = zlib.gzipSync(raw);
  const ratio = ((1 - compressed.length / raw.length) * 100).toFixed(0);
  console.log(` → ${(compressed.length / 1024 / 1024).toFixed(1)} MB (${ratio}% saved)`);

  // 5a. Local-only mode
  const outName = `codex-export-${host}-${machineId}-${Date.now()}.json.gz`;
  if (ARG_LOCAL) {
    const outPath = path.join(desktopDir(), outName);
    fs.writeFileSync(outPath, compressed);
    console.log(`\n  ${C.green}${C.bold}Done!${C.reset}`);
    console.log(`  Saved to Desktop: ${path.basename(outPath)}`);
    console.log(`  (${(compressed.length / 1024 / 1024).toFixed(1)} MB)\n`);
    return;
  }

  // 5b. Upload
  process.stdout.write(`${stamp()} Uploading to ${UPLOAD_URL}...`);
  try {
    const result = await upload(compressed, machineId, host, user);
    process.stdout.write(" done.\n");
    console.log(`${stamp()} ${C.green}Server:${C.reset} ${result}`);
    console.log(`\n  ${C.green}${C.bold}Done! Data sent successfully.${C.reset}`);
    console.log(`  You can close this window now.\n`);
  } catch (e) {
    console.log(`\n${stamp()} ${C.red}Upload failed:${C.reset} ${e.message}`);
    // Fallback: save to Desktop
    const fallback = path.join(desktopDir(), outName);
    fs.writeFileSync(fallback, compressed);
    console.log(`${stamp()} ${C.yellow}Saved to Desktop as fallback:${C.reset} ${path.basename(fallback)}`);
    console.log(`\n  ${C.yellow}Upload failed, but the exported file is on your Desktop.${C.reset}`);
    console.log(`  Please send it manually to the person who needs it.\n`);
  }
}

main().catch((e) => {
  console.error(C.red + e.stack + C.reset);
  process.exit(1);
});
