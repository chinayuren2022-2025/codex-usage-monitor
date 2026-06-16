#!/usr/bin/env node
// Download exported data from the receiver server.
//
//   node fetch-exports.mjs                → list available exports
//   node fetch-exports.mjs --all          → download all
//   node fetch-exports.mjs --latest       → download the most recent one (default)
//   node fetch-exports.mjs <filename>     → download a specific file
"use strict";

import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.RECEIVER_URL || "https://47.122.119.25/codex-export";
const API_KEY = process.env.EXPORT_KEY || "codex-cal-2026";
const OUT_DIR = path.join(__dirname, "..", "exported-data");

function urlOpts(urlPath) {
  const u = new URL(BASE_URL);
  const isIP = /^\d+\.\d+\.\d+\.\d+$/.test(u.hostname);
  return {
    hostname: u.hostname,
    port: u.port || 443,
    path: u.pathname.replace(/\/$/, "") + urlPath,
    rejectUnauthorized: false,
    extraHeaders: isIP ? { Host: u.hostname } : {},
  };
}

function request(opts) {
  return https.request({ ...opts, headers: { ...opts.extraHeaders, ...opts.headers } });
}

const C = { reset: "\x1b[0m", bold: "\x1b[1m", green: "\x1b[32m", yellow: "\x1b[33m", red: "\x1b[31m", cyan: "\x1b[36m" };

fs.mkdirSync(OUT_DIR, { recursive: true });

function apiGet(p) {
  return new Promise((resolve, reject) => {
    const req = request(
      { ...urlOpts(p), method: "GET", headers: { Authorization: `Bearer ${API_KEY}` }, timeout: 30000 },
      (res) => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve(body));
      }
    );
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    req.end();
  });
}

function downloadFile(filename, outName) {
  return new Promise((resolve, reject) => {
    const fp = path.join(OUT_DIR, outName || filename);
    const req = request(
      {
        ...urlOpts("/download/" + encodeURIComponent(filename)),
        method: "GET",
        headers: { Authorization: `Bearer ${API_KEY}` },
        timeout: 300_000,
      },
      (res) => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        let bytes = 0;
        const ws = fs.createWriteStream(fp);
        res.on("data", (c) => { bytes += c.length; ws.write(c); });
        res.on("end", () => { ws.end(); resolve({ path: fp, size: bytes }); });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    req.end();
  });
}

function parseHtmlList(html) {
  // Extract download links from the receiver's web page.
  // Links may be absolute (/codex-export/download/xxx) or relative (/download/xxx).
  const files = [];
  const re = /<a href="[^"]*\/download\/([^"]+?)">/g;
  let m;
  while ((m = re.exec(html))) files.push(decodeURIComponent(m[1]));
  return files;
}

async function main() {
  const arg = process.argv[2];
  console.log(`\n  ${C.bold}Fetch Exports${C.reset}  →  ${BASE_URL}\n`);

  // Fetch the index page to get file list
  let html;
  try {
    html = await apiGet("/");
  } catch (e) {
    console.log(`  ${C.red}Cannot reach receiver:${C.reset} ${e.message}\n`);
    process.exit(1);
  }
  const files = parseHtmlList(html);
  if (files.length === 0) {
    console.log(`  ${C.yellow}No exports on the server yet.${C.reset}\n`);
    process.exit(0);
  }

  console.log(`  ${files.length} export(s) on server:\n`);
  files.forEach((f, i) => console.log(`    ${i + 1}. ${f}`));
  console.log("");

  // Determine which files to download
  let toDownload = [];
  if (arg === "--all") {
    toDownload = files;
  } else if (arg === "--latest" || !arg) {
    toDownload = [files[0]]; // files are sorted newest-first in the HTML
  } else if (arg && !arg.startsWith("--")) {
    if (files.includes(arg)) toDownload = [arg];
    else {
      console.log(`  ${C.red}File not found on server:${C.reset} ${arg}\n`);
      process.exit(1);
    }
  }

  // Download
  for (const f of toDownload) {
    process.stdout.write(`  Downloading ${f}...`);
    try {
      const result = await downloadFile(f);
      console.log(` ${C.green}done${C.reset} (${(result.size / 1024).toFixed(1)} KB)`);
      console.log(`    → ${result.path}`);
    } catch (e) {
      console.log(` ${C.red}failed:${C.reset} ${e.message}`);
    }
  }

  console.log(`\n  ${C.green}${C.bold}Done!${C.reset} Files saved in ${OUT_DIR}/`);
  console.log(`  Use: node src/anchor-snap.mjs --import=<file> to analyze.\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
