// Turns parsed sessions into the dashboard payload.
//
// Headline metric = "billable" tokens = (input - cached) + output.
// Cached input is shown separately because in agentic coding it is 60-80% of raw
// input (re-sent context) and would make the carpool number meaningless.

import fs from "node:fs";
import path from "node:path";
import { codexHome } from "./parse.mjs";
import { CALIBRATION } from "./calibration.mjs";

const MIN = 60_000;
const DAY = 86_400_000;

function installationId() {
  try {
    return fs.readFileSync(path.join(codexHome(), "installation_id"), "utf8").trim();
  } catch {
    return null;
  }
}

function blank() {
  return {
    billable: 0,
    total: 0,
    input: 0,
    cached: 0,
    uncachedInput: 0,
    output: 0,
    reasoning: 0,
    events: 0,
  };
}

function isUsage(ev) {
  return (ev.total || 0) > 0 || (ev.input || 0) > 0 || (ev.output || 0) > 0;
}

function add(acc, ev) {
  const input = ev.input || 0;
  const cached = ev.cached || 0;
  const output = ev.output || 0;
  const uncached = Math.max(0, input - cached);
  acc.input += input;
  acc.cached += cached;
  acc.uncachedInput += uncached;
  acc.output += output;
  acc.reasoning += ev.reasoning || 0;
  acc.total += ev.total || 0;
  acc.billable += uncached + output;
  acc.events += 1;
}

function merge(dst, src) {
  for (const k of Object.keys(dst)) dst[k] += src[k];
}

function localDateKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

// One row per account (= plan tier) seen in the logs, for the account selector.
function summarizeAccounts(sessions) {
  const m = new Map();
  for (const s of sessions) {
    const key = s.account || "unknown";
    let hasTok = false,
      bill = 0,
      total = 0,
      last = 0;
    for (const ev of s.events) {
      if (!isUsage(ev)) continue;
      hasTok = true;
      bill += Math.max(0, (ev.input || 0) - (ev.cached || 0)) + (ev.output || 0);
      total += ev.total || 0;
      const ms = ev.ts ? Date.parse(ev.ts) : NaN;
      if (Number.isFinite(ms) && ms > last) last = ms;
    }
    if (!hasTok) continue;
    if (!m.has(key)) m.set(key, { account: key, sessions: 0, billable: 0, total: 0, lastMs: 0 });
    const e = m.get(key);
    e.sessions += 1;
    e.billable += bill;
    e.total += total;
    if (last > e.lastMs) e.lastMs = last;
  }
  return [...m.values()].sort((a, b) => b.lastMs - a.lastMs);
}

export function aggregate(sessions, { dailyDays = 30, account = null } = {}) {
  const now = Date.now();

  // Account list is computed over ALL sessions; the rest is scoped to the
  // selected account so usage from a different login never bleeds in.
  const accountsList = summarizeAccounts(sessions);
  // account param: "all" => mixed (no filter); a specific key => that account;
  // null/undefined => default to the most-recently-used account (open scoped to
  // the current login).
  const viewed =
    account === "all" ? null : account ? account : accountsList[0]?.account ?? null;
  if (viewed) sessions = sessions.filter((s) => (s.account || "unknown") === viewed);
  // The token->% conversion is tier-specific. plus is measured; pro/prolite are
  // derived by quota multiplier; team/unknown have none.
  const tierCal = viewed ? CALIBRATION.tiers[viewed] : null;
  const calibrated = !!tierCal;
  const all = blank();
  const daily = new Map(); // localDateKey -> acc
  const byModel = new Map();
  const byProject = new Map();
  const flat = []; // {ms, ev} for window queries
  let latestRate = null;
  let latestRateMs = -1;
  let sessionCount = 0;
  let firstMs = Infinity;
  let lastMs = 0;

  for (const s of sessions) {
    const sessAcc = blank();
    let sessModel = null;
    let hasTok = false;

    for (const ev of s.events) {
      const ms = ev.ts ? Date.parse(ev.ts) : NaN;
      if (ev.rate) {
        if (ev.rate.limitName) sessModel = ev.rate.limitName;
        if (Number.isFinite(ms) && ms > latestRateMs) {
          latestRateMs = ms;
          latestRate = { asOf: ev.ts, ...ev.rate };
        }
      }
      if (!isUsage(ev) || !Number.isFinite(ms)) continue;
      hasTok = true;
      add(all, ev);
      add(sessAcc, ev);
      flat.push({ ms, ev });
      if (ms < firstMs) firstMs = ms;
      if (ms > lastMs) lastMs = ms;
      const key = localDateKey(ms);
      if (!daily.has(key)) daily.set(key, blank());
      add(daily.get(key), ev);
    }

    if (hasTok) {
      sessionCount += 1;
      const model = sessModel || "unknown";
      if (!byModel.has(model)) byModel.set(model, blank());
      merge(byModel.get(model), sessAcc);
      const proj = s.meta?.cwd || "unknown";
      if (!byProject.has(proj)) byProject.set(proj, blank());
      merge(byProject.get(proj), sessAcc);
    }
  }

  const windowSince = (startMs) => {
    const acc = blank();
    for (const { ms, ev } of flat) if (ms >= startMs) add(acc, ev);
    return acc;
  };

  // Decoupled by design:
  //  - machine usage = a ROLLING window from now -> always fresh, never stale.
  //  - account % = a snapshot from the last token_count event; flagged `expired`
  //    once its resets_at is in the past (idle machine = the common case).
  //  - attribution = this machine's share of the account quota. The quota meter
  //    counts TOTAL tokens (see calibration.mjs), so we attribute by total tokens
  //    over the account's REAL window ([resetsAt - window, now]) and divide by the
  //    calibrated tokens-per-percent. The account used_percent stays the exact
  //    wall-distance; k only splits "本机 vs 其他".
  const buildWindow = (w, defaultMinutes, calib) => {
    const windowMinutes = w?.windowMinutes || defaultMinutes;
    const usage = windowSince(now - windowMinutes * MIN);
    let account = null;
    let attribution = null;
    if (w) {
      const resetsAt = w.resetsAt != null ? w.resetsAt * 1000 : null;
      const expired = resetsAt != null ? resetsAt < now : false;
      account = {
        usedPercent: w.usedPercent ?? null,
        resetsAt,
        msToReset: resetsAt != null ? resetsAt - now : null,
        expired,
        asOf: latestRate?.asOf || null,
      };

      if (calib && calib.tokensPerPercent > 0) {
        // Align the machine total to the account's current window when we can.
        const windowStart =
          resetsAt != null && !expired ? resetsAt - windowMinutes * MIN : now - windowMinutes * MIN;
        const machineTotal = windowSince(windowStart).total;
        const usedPct = w.usedPercent ?? null;
        // machineTotal (tokens) is valid for any account; the % conversion is only
        // trustworthy when the viewed tier matches the calibration.
        if (calibrated) {
          const tpp = calib.tokensPerPercent;
          const machinePoints = machineTotal / tpp; // == 本机占总额度的 %
          attribution = {
            calibrated: true,
            source: calib.source, // per-window: measured | derived | rough
            basis: CALIBRATION.basis,
            regime: CALIBRATION.regime,
            anchoredAt: CALIBRATION.anchoredAt,
            tokensPerPercent: tpp,
            poolTokens: calib.poolTokens,
            machineTotal,
            windowStart: new Date(windowStart).toISOString(),
            machinePoints,
            accountUsedPercent: usedPct,
            othersPoints: usedPct != null ? Math.max(0, usedPct - machinePoints) : null,
            shareOfUsed: usedPct && usedPct > 0 ? (machinePoints / usedPct) * 100 : null,
            overAttributed: usedPct != null && machinePoints > usedPct + 1,
            expired,
          };
        } else {
          // Uncalibrated tier: show tokens, no % conversion.
          attribution = {
            calibrated: false,
            machineTotal,
            windowStart: new Date(windowStart).toISOString(),
            machinePoints: null,
            accountUsedPercent: usedPct,
            shareOfUsed: null,
            expired,
          };
        }
      }
    }
    return { windowMinutes, usage, account, attribution };
  };

  const windows = {
    fiveHour: buildWindow(latestRate?.primary, 300, tierCal?.windows.fiveHour),
    weekly: buildWindow(latestRate?.secondary, 10080, tierCal?.windows.weekly),
  };

  // Today (local calendar day) as a quick at-a-glance number.
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const today = windowSince(todayStart.getTime());

  // Daily series for the bar chart: last `dailyDays` calendar days, zero-filled.
  const series = [];
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  for (let i = dailyDays - 1; i >= 0; i--) {
    const d = new Date(cursor.getTime() - i * DAY);
    const key = localDateKey(d.getTime());
    const acc = daily.get(key) || blank();
    series.push({ date: key, billable: acc.billable, total: acc.total, cached: acc.cached });
  }

  const sortDesc = (map) =>
    [...map.entries()]
      .map(([name, acc]) => ({ name, ...acc }))
      .sort((a, b) => b.billable - a.billable);

  return {
    generatedAt: new Date(now).toISOString(),
    accounts: accountsList.map((a) => ({
      account: a.account,
      sessions: a.sessions,
      billable: a.billable,
      total: a.total,
      lastUsed: a.lastMs ? new Date(a.lastMs).toISOString() : null,
      calibratedTier: !!CALIBRATION.tiers[a.account],
      calibrationSource: CALIBRATION.tiers[a.account]?.source || null, // measured | validated | derived | null
    })),
    selectedAccount: viewed,
    calibrated,
    calibrationSource: tierCal?.source || null,
    baselineTier: CALIBRATION.baselineTier,
    machine: { installationId: installationId() },
    span: {
      first: Number.isFinite(firstMs) ? new Date(firstMs).toISOString() : null,
      last: lastMs ? new Date(lastMs).toISOString() : null,
      sessions: sessionCount,
    },
    totals: all,
    today,
    windows,
    calibration: CALIBRATION, // how quota % is mapped to total tokens (see calibration.mjs)
    quota: latestRate, // account-wide snapshot, as-of latestRate.asOf
    daily: series,
    byModel: sortDesc(byModel),
    byProject: sortDesc(byProject).slice(0, 12),
  };
}
