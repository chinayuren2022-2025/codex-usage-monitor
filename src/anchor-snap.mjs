#!/usr/bin/env node
// One-shot snapshot of an anchoring run for the 5h (primary) window. Scopes to
// session files modified in the last --mins minutes and to one account tier.
//
//   node src/anchor-snap.mjs [--mins=30] [--account=pro]
//
// The rate-limit meter counts TOTAL tokens (incl cached), not billable.
//
// TWO independent estimates of k_5h (= total tokens per 1% of the 5h pool):
//
//   A) DIRECT (kAvg):  machineTotal / Δ5h%
//        Correct only if YOU were the sole user (clean / teammate-idle window).
//
//   B) RATIO (contamination-proof):  k_weekly_known × (Δweekly% / Δ5h%)
//        Both windows count the SAME tokens (everyone's), so teammate usage cancels
//        in the ratio. Needs the weekly pool to be already known for this tier
//        (pro weekly = 20x Plus, from calibration.mjs). Precision is limited by how
//        many weekly points moved (weekly pool is large, so it moves slowly).
//
// Cross-check: kAvg / k_ratio = your share of total consumption in the window, so
//   contamination(teammates) = 1 - kAvg/k_ratio. Low contamination => both agree
//   => high confidence. High contamination => trust the ratio (if Δweekly >= ~2).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listSessionFiles, parseSessionFile, sessionsDir } from "./parse.mjs";
import { CALIBRATION } from "./calibration.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "anchor-result.json");
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=?(.*)$/);
    return m ? [m[1], m[2] || true] : [a, true];
  })
);
const MINS = Number(args.mins || 30);
const ACCOUNT = typeof args.account === "string" ? args.account : null;
const GAP_MS = 8 * 60000; // a gap longer than this breaks contiguity (5h window ages)

const fmt = (n) =>
  n == null
    ? "—"
    : Math.abs(n) >= 1e9
    ? (n / 1e9).toFixed(2) + "B"
    : Math.abs(n) >= 1e6
    ? (n / 1e6).toFixed(2) + "M"
    : Math.abs(n) >= 1e3
    ? (n / 1e3).toFixed(1) + "K"
    : String(Math.round(n));

const cutoff = Date.now() - MINS * 60000;
const files = listSessionFiles().filter((f) => {
  try {
    return fs.statSync(f).mtimeMs >= cutoff;
  } catch {
    return false;
  }
});

// gather rate-bearing events for the chosen account, time-sorted
const evs = [];
let planType = null;
for (const f of files) {
  const { events, account } = await parseSessionFile(f);
  if (ACCOUNT && (account || "unknown") !== ACCOUNT) continue;
  for (const ev of events) {
    if (!ev.rate?.primary) continue;
    const ms = ev.ts ? Date.parse(ev.ts) : NaN;
    if (!Number.isFinite(ms)) continue;
    planType = ev.rate.planType || planType;
    evs.push({ ms, total: ev.total || 0, p: ev.rate.primary.usedPercent, s: ev.rate.secondary?.usedPercent ?? null });
  }
}
evs.sort((a, b) => a.ms - b.ms);

// Accumulate Δ5h%, Δweekly%, and machine total tokens over CONTIGUOUS activity
// (skip transitions across long gaps, where the rolling 5h meter ages out).
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
    continue; // gap: meter may have aged / teammates ran; don't trust this delta
  }
  if (b.p > a.p) {
    dP += b.p - a.p;
    steps++;
  }
  if (b.s != null && a.s != null && b.s > a.s) dS += b.s - a.s;
}

// weekly k for this tier (the anchor for the ratio method)
const tier = ACCOUNT ? CALIBRATION.tiers[ACCOUNT] : null;
const kWeekly = tier?.windows.weekly.tokensPerPercent ?? null;

const kAvg = dP > 0 ? machineTotal / dP : null; // direct (sole-user) estimate
const kRatio = kWeekly && dP > 0 ? kWeekly * (dS / dP) : null; // contamination-proof
const yourShare = kAvg != null && kRatio ? kAvg / kRatio : null;
const contamination = yourShare != null ? Math.max(0, 1 - yourShare) : null;

const warnings = [];
if (dP < 3) warnings.push(`5h 只动了 ${dP} 点，精度差，需要更长/更猛的会话`);
if (kRatio != null && dS < 2) warnings.push(`weekly 只动了 ${dS} 点 → 比值法误差大（±50%+）。要么跑久点让 weekly 多走几点，要么走"独占窗口"用直接法`);
if (!kWeekly) warnings.push(`账号 ${ACCOUNT || "(未指定)"} 的 weekly 池未知，无法用比值法。指定 --account=pro 等已知档位`);
if (contamination != null && contamination > 0.2)
  warnings.push(`估算 ${(contamination * 100).toFixed(0)}% 的消耗来自队友 → 直接法(kAvg)不可信，看比值法(kRatio)`);
if (contamination != null && contamination < 0.1 && dS >= 2)
  warnings.push(`污染低且两法接近 → 结果可信`);

const result = {
  updated: new Date().toISOString(),
  account: ACCOUNT,
  planType,
  scannedFiles: files.length,
  windowMins: MINS,
  events: evs.length,
  contiguousSteps: steps,
  gapsSkipped: breaks,
  d5hPercent: dP,
  dWeeklyPercent: dS,
  machineTotal,
  kWeeklyKnown: kWeekly,
  kAvg_direct: kAvg,
  kRatio_contaminationProof: kRatio,
  pool5h_direct: kAvg != null ? kAvg * 100 : null,
  pool5h_ratio: kRatio != null ? kRatio * 100 : null,
  yourShareOfWindow: yourShare,
  contamination,
  warnings,
};
fs.writeFileSync(OUT, JSON.stringify(result, null, 2));

console.log(`数据源 ${sessionsDir()} | 近 ${MINS} 分钟 ${files.length} 文件 | 账号 ${ACCOUNT || "(全部)"} plan=${planType}`);
console.log(`连续步 ${steps} 个（跳过 ${breaks} 个间隔）| 本机 ${fmt(machineTotal)} total`);
console.log(`Δ5h = ${dP} 点 · Δweekly = ${dS} 点`);
console.log(``);
console.log(`A) 直接法  k_5h = ${fmt(kAvg)}/%   → 5h 池 ≈ ${fmt(result.pool5h_direct)}   (仅当你独占)`);
console.log(`B) 比值法  k_5h = ${fmt(kRatio)}/%   → 5h 池 ≈ ${fmt(result.pool5h_ratio)}   (抗污染, 锚定 weekly=${fmt(kWeekly)}/%)`);
console.log(`估算队友污染: ${contamination != null ? (contamination * 100).toFixed(0) + "%" : "—"}  (你占本段消耗 ${yourShare != null ? (yourShare * 100).toFixed(0) + "%" : "—"})`);
if (warnings.length) console.log("\n注意:\n  - " + warnings.join("\n  - "));
