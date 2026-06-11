// Parses Codex session rollout files (~/.codex/sessions/**/*.jsonl).
//
// The only records we care about:
//   - session_meta : cwd / cli_version / source / start time
//   - token_count  : per-turn usage (last_token_usage) + account rate_limits snapshot
//
// Verified accounting facts (see README):
//   total = input + output ; input ALREADY includes cached ; reasoning ⊆ output ;
//   sum(last_token_usage) over a session == final total_token_usage.
// So last_token_usage is a clean, non-overlapping per-turn delta we can bucket by its
// own timestamp without worrying about context-compaction resets.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

export function codexHome() {
  return process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
}

export function sessionsDir() {
  return process.env.CODEX_SESSIONS_DIR || path.join(codexHome(), "sessions");
}

/** Recursively list all *.jsonl rollout files under the sessions dir. */
export function listSessionFiles(dir = sessionsDir()) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listSessionFiles(p));
    else if (e.isFile() && e.name.endsWith(".jsonl")) out.push(p);
  }
  return out;
}

/**
 * Parse a single rollout file.
 * Returns { file, meta, events:[{ts, input, cached, output, reasoning, total, rate}] }
 * Rate snapshots are attached to the event that carried them (rate may be null).
 */
export async function parseSessionFile(file) {
  const rl = readline.createInterface({
    input: fs.createReadStream(file, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  let meta = null;
  const events = [];

  for await (const line of rl) {
    if (!line) continue;
    // Cheap pre-filter: most lines are huge message/content payloads we don't need.
    const wantMeta = !meta && line.includes('"session_meta"');
    const wantTok = line.includes('"token_count"');
    if (!wantMeta && !wantTok) continue;

    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const p = o?.payload;
    if (!p) continue;

    // session_meta: type is at the TOP level, fields live directly in payload.
    // token_count: wrapped as { type:"event_msg", payload:{ type:"token_count", ... } }.
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
            ? {
                usedPercent: w.used_percent ?? null,
                windowMinutes: w.window_minutes ?? null,
                resetsAt: w.resets_at ?? null,
              }
            : null;
        ev.rate = {
          limitName: r.limit_name || r.limit_id || null,
          planType: r.plan_type ?? null, // "plus" | "pro" | "prolite" | "team" | null
          primary: win(r.primary),
          secondary: win(r.secondary),
        };
      }
      events.push(ev);
    }
  }

  // Account key for this session = the plan tier seen in its rate events. Codex
  // doesn't stamp a per-account id, but plan_type ("plus"/"pro"/...) cleanly
  // separates accounts of different tiers (the common case when switching logins).
  let account = null;
  for (const ev of events) {
    if (ev.rate?.planType) account = ev.rate.planType; // last non-null wins
  }

  return { file, meta, events, account };
}

// ---- mtime/size cache: immutable historical files are parsed once. ----
const cache = new Map(); // file -> { mtimeMs, size, parsed }

export async function loadAll() {
  const files = listSessionFiles();
  const results = [];
  for (const f of files) {
    let st;
    try {
      st = fs.statSync(f);
    } catch {
      continue;
    }
    const hit = cache.get(f);
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) {
      results.push(hit.parsed);
      continue;
    }
    const parsed = await parseSessionFile(f);
    cache.set(f, { mtimeMs: st.mtimeMs, size: st.size, parsed });
    results.push(parsed);
  }
  return results;
}
