#!/usr/bin/env node
// Quick terminal report (ccusage-style), in case you don't want the web UI.
//   node src/cli.mjs

import { loadAll, sessionsDir } from "./parse.mjs";
import { aggregate } from "./aggregate.mjs";

const fmt = (n) => {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(n | 0);
};
const pct = (p) => (p == null ? "  ? " : String(Math.round(p)).padStart(3) + "%");

const sessions = await loadAll();
// --account=plus|pro|...|all  (default "all" so the terminal report stays全量)
const accArg = process.argv.find((a) => a.startsWith("--account="));
const account = accArg ? accArg.split("=")[1] : "all";
const d = aggregate(sessions, { account });

console.log(`\nCodex usage on ${d.machine?.installationId?.slice(0, 8) || "this machine"}  (${d.span.sessions} sessions, ${d.span.first?.slice(0, 10)} → ${d.span.last?.slice(0, 10)})`);
console.log(
  `  账号(${d.selectedAccount || "全部"}): ` +
    d.accounts
      .map((a) => `${a.account}${a.calibratedTier ? "*" : ""}=${fmt(a.billable)}`)
      .join("  ") +
    "   (* = 已标定; 用 --account=plus 切换)\n"
);

const line = (label, acc) =>
  console.log(
    `  ${label.padEnd(14)} billable ${fmt(acc.billable).padStart(8)}   (cached ${fmt(acc.cached)})`
  );
line("All-time", d.totals);
line("Today", d.today);
const acct = (w) => {
  const a = w?.account;
  if (!a || a.usedPercent == null) return "account   ?";
  return `account ${pct(a.usedPercent)} used${a.expired ? " (snapshot expired)" : ""}`;
};
if (d.windows.fiveHour)
  console.log(
    `  近 5 小时      billable ${fmt(d.windows.fiveHour.usage.billable).padStart(8)}   ${acct(d.windows.fiveHour)}`
  );
if (d.windows.weekly)
  console.log(
    `  近 7 天        billable ${fmt(d.windows.weekly.usage.billable).padStart(8)}   ${acct(d.windows.weekly)}`
  );

console.log("\n  By project:");
for (const p of d.byProject.slice(0, 8))
  console.log(`    ${fmt(p.billable).padStart(8)}  ${p.name}`);

console.log("\n  Last 14 days:");
for (const day of d.daily.slice(-14)) {
  const bar = "█".repeat(Math.round((day.billable / Math.max(1, Math.max(...d.daily.map((x) => x.billable)))) * 24));
  console.log(`    ${day.date}  ${fmt(day.billable).padStart(8)}  ${bar}`);
}
console.log(`\n  (source: ${sessionsDir()})\n`);
