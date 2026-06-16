#!/usr/bin/env node
// Analyze an exported Codex usage file for calibration.
//
//   node analyze-export.mjs <file.json.gz> [--account=pro]
//
// Reads the gzipped export, extracts rate-bearing events, and runs
// the same direct/ratio calibration as anchor-snap.mjs but on
// multi-machine aggregate data.
"use strict";

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const args = process.argv.slice(2);
const fileArg = args.find((a) => !a.startsWith("--"));
const accArg = args.find((a) => a.startsWith("--account="));
const ACCOUNT = accArg ? accArg.split("=")[1] : null;
const GAP_MS = 8 * 60000;

if (!fileArg) {
  console.log("Usage: node analyze-export.mjs <file.json.gz> [--account=pro]");
  console.log("");
  console.log("  Reads an exported Codex usage file and runs calibration analysis.");
  console.log("  Use --account=pro to filter to a specific plan_type (recommended).");
  process.exit(1);
}

const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", green: "\x1b[32m", yellow: "\x1b[33m", red: "\x1b[31m", cyan: "\x1b[36m",
};
const fmt = (n) =>
  n == null
    ? "—"
    : Math.abs(n) >= 1e9 ? (n / 1e9).toFixed(2) + "B"
    : Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(2) + "M"
    : Math.abs(n) >= 1e3 ? (n / 1e3).toFixed(1) + "K"
    : String(Math.round(n));

// ===== calibration constants (same as calibration.mjs) =====
const PLUS_WK = 1_156_000;
const TIERS = {
  plus: { weekly: PLUS_WK, source: "measured" },
  prolite: { weekly: PLUS_WK * 5, source: "derived" },
  pro: { weekly: PLUS_WK * 20, source: "derived (20x Plus weekly)" },
};

console.log(`\n  ${C.bold}Analyze Export${C.reset}`);
console.log(`  File    : ${path.basename(fileArg)}`);
console.log(`  Account : ${ACCOUNT || "(all)"}`);

// Read and decompress
let raw;
try {
  const buf = fs.readFileSync(fileArg);
  raw = zlib.gunzipSync(buf);
} catch {
  // Maybe it's uncompressed JSON
  raw = fs.readFileSync(fileArg);
}
const data = JSON.parse(raw.toString());

console.log(`  Source  : ${data.hostname || "?"} (${data.installationId || "?"})`);
console.log(`  User    : ${data.username || "?"}`);
console.log(`  Exported: ${data.exportedAt || "?"}`);
console.log(`  Sessions: ${data.sessions?.length || 0}`);

// Extract all rate-bearing events
const evs = [];
let planType = null;
let totalTokens = 0,
  totalBillable = 0,
  sessionCount = 0;

for (const s of data.sessions || []) {
  if (ACCOUNT && s.account !== ACCOUNT) continue;
  let hasTok = false;
  for (const ev of s.events || []) {
    const ms = ev.ts ? Date.parse(ev.ts) : NaN;
    if (!Number.isFinite(ms)) continue;

    totalTokens += ev.total || 0;
    totalBillable += Math.max(0, (ev.input || 0) - (ev.cached || 0)) + (ev.output || 0);

    if (ev.rate) {
      planType = ev.rate.planType || planType;
      if (ev.rate.primary) {
        evs.push({
          ms,
          total: ev.total || 0,
          p: ev.rate.primary.usedPercent,
          s: ev.rate.secondary?.usedPercent ?? null,
        });
      }
    }
    hasTok = true;
  }
  if (hasTok) sessionCount++;
}
evs.sort((a, b) => a.ms - b.ms);

console.log(`  Events  : ${evs.length} rate-bearing token_count events`);
console.log(`  Tokens  : total=${fmt(totalTokens)}  billable=${fmt(totalBillable)}`);
console.log(`  Plan    : ${planType || "unknown"}`);
console.log("");

if (evs.length < 2) {
  console.log(`  ${C.yellow}Not enough rate-bearing events for calibration. Need at least 2.${C.reset}\n`);
  process.exit(0);
}

// Accumulate Δ5h%, Δweekly%, machine total over contiguous segments
let dP = 0,
  dS = 0,
  machineTotal = 0,
  steps = 0,
  breaks = 0;
for (let i = 1; i < evs.length; i++) {
  const a = evs[i - 1],
    b = evs[i];
  machineTotal += b.total;
  if (b.ms - a.ms > GAP_MS) {
    breaks++;
    continue;
  }
  if (b.p != null && a.p != null && b.p > a.p) {
    dP += b.p - a.p;
    steps++;
  }
  if (b.s != null && a.s != null && b.s > a.s) dS += b.s - a.s;
}

const tier = TIERS[planType] || TIERS[ACCOUNT];
const kWeekly = tier?.weekly ?? null;

const kAvg = dP > 0 ? machineTotal / dP : null;
const kRatio = kWeekly && dP > 0 ? kWeekly * (dS / dP) : null;
const yourShare = kAvg != null && kRatio != null ? kAvg / kRatio : null;
const contamination = yourShare != null ? Math.max(0, 1 - yourShare) : null;

// Print results
console.log(`  ${C.bold}Calibration Results${C.reset}`);
console.log(`  ${"─".repeat(50)}`);
console.log(`  Contiguous steps    : ${steps}  (gaps skipped: ${breaks})`);
console.log(`  Δ5h percentage      : ${dP.toFixed(1)} pts`);
console.log(`  ΔWeekly percentage  : ${dS.toFixed(1)} pts`);
console.log(`  Machine total tokens : ${fmt(machineTotal)}`);
console.log(`  Tier                 : ${planType || "unknown"}${tier ? ` (weekly=${fmt(tier.weekly)}/%, ${tier.source})` : " — uncalibrated"}`);
console.log("");

console.log(`  ${C.bold}Method A — Direct (sole-user estimate)${C.reset}`);
console.log(`  k_5h        = ${fmt(kAvg)}/%`);
console.log(`  5h pool     ≈ ${kAvg ? fmt(kAvg * 100) : "—"}`);
console.log("");

console.log(`  ${C.bold}Method B — Ratio (contamination-proof)${C.reset}`);
console.log(`  k_5h        = ${fmt(kRatio)}/%`);
console.log(`  5h pool     ≈ ${kRatio ? fmt(kRatio * 100) : "—"}`);
console.log("");

if (contamination != null) {
  console.log(`  ${C.bold}Contamination estimate${C.reset}`);
  console.log(`  Your share  : ${((yourShare || 0) * 100).toFixed(0)}% of window consumption`);
  console.log(`  Teammates   : ${(contamination * 100).toFixed(0)}%`);
  console.log("");
}

// Warnings
const warnings = [];
if (dP < 3) warnings.push(`Δ5h only ${dP.toFixed(1)} pts — low precision, need more usage data`);
if (kRatio != null && dS < 2) warnings.push(`ΔWeekly only ${dS.toFixed(1)} pts — ratio method error ~±50%`);
if (!kWeekly) warnings.push(`No weekly calibration for tier "${planType}" — ratio method unavailable`);
if (contamination != null && contamination > 0.2) warnings.push(`~${(contamination * 100).toFixed(0)}% from teammates → trust ratio method (B), not direct`);
if (contamination != null && contamination < 0.1 && dS >= 2) warnings.push(`Low contamination + agreement → results are trustworthy`);

if (warnings.length) {
  console.log(`  ${C.yellow}Notes:${C.reset}`);
  for (const w of warnings) console.log(`    - ${w}`);
  console.log("");
}

// Summary: what to put in calibration.mjs
if (kRatio && planType === "pro") {
  const pool = kRatio * 100;
  console.log(`  ${C.green}${C.bold}For calibration.mjs — pro tier:${C.reset}`);
  console.log(`  5h: w(${Math.round(kRatio / 1000)}_000, "rough")   // pool ~${fmt(pool)}`);
  console.log(`  weekly: w(${fmt(kWeekly)} * 20, "derived")          // unchanged`);
  console.log("");
}

// Per-session breakdown
console.log(`  ${C.bold}Per-session summary${C.reset}`);
for (const s of data.sessions || []) {
  if (ACCOUNT && s.account !== ACCOUNT) continue;
  const n = s.events?.length || 0;
  const tok = s.events?.reduce((sum, e) => sum + (e.total || 0), 0) || 0;
  const started = s.meta?.startedAt?.slice(0, 19) || "?";
  const name = s.meta?.cwd?.split(/[\\/]/).pop() || s.meta?.cwd || "?";
  console.log(`    ${s.account || "?"}  ${fmt(tok).padStart(8)}  ${n.toString().padStart(3)} ev  ${started}  ${name}`);
}
console.log("");
