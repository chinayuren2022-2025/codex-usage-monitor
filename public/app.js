const REFRESH_MS = 15000;

const fmt = (n) => {
  n = n || 0;
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(Math.round(n));
};

const fmtFull = (n) => (n || 0).toLocaleString("en-US");

function fmtDuration(ms) {
  if (ms == null) return "—";
  const past = ms < 0;
  ms = Math.abs(ms);
  const m = Math.round(ms / 60000);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const mm = m % 60;
  let s;
  if (d > 0) s = `${d}天 ${h}小时`;
  else if (h > 0) s = `${h}小时 ${mm}分`;
  else s = `${mm}分`;
  return past ? `${s}前` : `${s}后`;
}

function pctColor(p) {
  if (p == null) return "var(--muted)";
  if (p >= 90) return "var(--danger)";
  if (p >= 70) return "var(--warn)";
  return "var(--accent)";
}

function ring(percent, stale) {
  const p = Math.max(0, Math.min(100, percent ?? 0));
  const r = 38;
  const c = 2 * Math.PI * r;
  const off = c * (1 - p / 100);
  const col = stale ? "var(--muted)" : pctColor(percent);
  const label = percent == null ? "?" : Math.round(percent) + "%";
  return `
  <svg class="ring" width="92" height="92" viewBox="0 0 92 92" ${stale ? 'opacity="0.55"' : ""}>
    <circle cx="46" cy="46" r="${r}" fill="none" stroke="var(--panel-2)" stroke-width="9"/>
    <circle cx="46" cy="46" r="${r}" fill="none" stroke="${col}" stroke-width="9"
      stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${off}"
      transform="rotate(-90 46 46)"/>
    <text x="46" y="50" text-anchor="middle" font-size="19" font-weight="700">${label}</text>
    <text x="46" y="64" text-anchor="middle" font-size="9" fill="var(--muted)">${stale ? "已过期" : "账户额度"}</text>
  </svg>`;
}

// Current display unit for machine usage: "percent" (share of quota pool) or
// "token" (raw total tokens). Persisted so it survives refreshes.
let unitMode = (typeof localStorage !== "undefined" && localStorage.getItem("unitMode")) || "percent";

// Single bar = this machine's share of the FULL pool (machinePoints% of 100%).
function machineBar(machinePoints, stale) {
  const m = Math.max(0, Math.min(100, machinePoints || 0));
  const col = stale ? "var(--muted)" : "var(--accent)";
  return `<div class="split" title="本机占额度池 ${m.toFixed(1)}% · 剩余 ${(100 - m).toFixed(1)}%">
    <span style="width:${m}%;background:${col}"></span>
  </div>`;
}

function windowCard(title, machineLabel, w, provisional) {
  if (!w) return `<div class="card"><div class="window-title">${title}</div><div class="hint">暂无数据</div></div>`;
  const acc = w.account;
  const pct = acc ? acc.usedPercent : null;
  const a = w.attribution;
  const stale = !!acc?.expired;

  // Account-info reading (the same number Codex shows under 剩余用量), kept distinct
  // from this machine's usage. Caption mirrors Codex's "剩余" wording.
  let accLine;
  if (!acc || pct == null) {
    accLine = "账户额度未知（本机最近的会话里没有额度快照）";
  } else if (stale) {
    accLine = `账户已用 ${Math.round(pct)}%（剩余 ${100 - Math.round(pct)}%）· 该快照 ${fmtDuration(
      acc.msToReset
    )}，<b>可能已重置</b>`;
  } else {
    const asOfTxt = acc.asOf ? new Date(acc.asOf).toLocaleString("zh-CN", { hour12: false }) : "—";
    accLine = `账户已用 <b>${Math.round(pct)}%</b>（剩余 ${100 - Math.round(pct)}%）· <b>${fmtDuration(
      acc.msToReset
    )}</b>重置 · 截至 ${asOfTxt}`;
  }

  // Headline = how much quota THIS machine used, in the chosen unit. The other unit
  // is shown small underneath so both are always visible.
  let headline, unitSmall, subline, bar = "";
  let tag = "";
  if (a && a.calibrated) {
    // tokens are EXACT (counted from logs); the % is the calibrated estimate, so
    // the estimate marker always rides with the percentage, never the token count.
    // source: measured (实测) | derived (按套餐倍数推算) | rough (比值法粗标定)
    const src = a.source;
    const estLabel = src === "rough" ? "粗标" : src === "derived" ? "推算" : "估算";
    const pctStr = `${a.machinePoints.toFixed(a.machinePoints < 10 ? 1 : 0)}%`;
    const tokStr = fmt(a.machineTotal);
    if (unitMode === "token") {
      headline = tokStr;
      unitSmall = "本机用掉 · total token";
      subline = `≈ 占额度池 <b>${pctStr}</b><span class="est">${estLabel}</span>`;
    } else {
      headline = `${pctStr}<span class="est">${estLabel}</span>`;
      unitSmall = "本机用掉的额度";
      subline = `= <b>${tokStr}</b> total token（精确）`;
    }
    bar = machineBar(a.machinePoints, stale);
    if (src === "rough")
      tag = `<span class="tag" title="该窗口额度为粗标定（比值法，约±40%），会随用量自动收紧">粗标定</span>`;
    else if (src === "derived")
      tag = `<span class="tag" title="该档额度由 Plus 按套餐倍数推算，未在本机独立测量">倍数推算</span>`;
    else if (provisional)
      tag = `<span class="tag" title="换算系数为标定估算：接近标定用量时最准，偏离会漂移">额度为估算</span>`;
  } else if (a) {
    // Account tier has no calibration: tokens are exact, but no token->% mapping.
    const tokStr = fmt(a.machineTotal);
    headline = unitMode === "percent" ? `<span class="muted">未标定</span>` : tokStr;
    unitSmall = "本机用掉 · total token";
    subline = `本机 <b>${tokStr}</b> total token（精确）· 该档位未标定，不能换算额度%`;
    tag = `<span class="tag" title="只标定了 Plus 档；其它档位无换算系数">该档未标定</span>`;
  } else {
    headline = fmt(w.usage.total);
    unitSmall = "本机 total token";
    subline = "账户无额度快照，暂不能换算成额度 %";
  }

  return `
  <div class="card window ${stale ? "stale" : ""}">
    ${ring(pct, stale)}
    <div class="window-body">
      <div class="window-title">${title} ${tag}</div>
      <div class="window-machine">${headline}<small>${unitSmall}</small></div>
      <div class="window-meta">
        ${subline}<br/>
        ${bar}
        ${accLine}
      </div>
    </div>
  </div>`;
}

function statCard(num, lbl, extra) {
  return `<div class="card stat"><div class="num">${num}</div><div class="lbl">${lbl}</div>${
    extra ? `<div class="extra">${extra}</div>` : ""
  }</div>`;
}

function barRows(items, max, color) {
  if (!items.length) return `<div class="hint">暂无数据</div>`;
  return items
    .map((it) => {
      const w = max > 0 ? (it.billable / max) * 100 : 0;
      const name =
        it.name === "unknown" ? "(未知)" : it.name === "codex" ? "codex (旧版会话)" : it.name;
      return `<div class="row"><div class="label" title="${name}">${name}</div><div class="val">${fmt(
        it.billable
      )}</div><div class="track"><span style="width:${w}%;background:${color}"></span></div></div>`;
    })
    .join("");
}

const ACCOUNT_LABELS = { plus: "Plus", pro: "Pro", prolite: "Pro Lite", team: "Team", unknown: "未标记" };
const accountLabel = (k) => ACCOUNT_LABELS[k] || (k ? k[0].toUpperCase() + k.slice(1) : "全部");

// Account param to request: null => server default (latest login); "all" => mixed;
// otherwise a specific plan tier key. Persisted so a choice survives refreshes.
let currentAccount =
  (typeof localStorage !== "undefined" && localStorage.getItem("account")) || null;

function renderAccountTabs(d) {
  const box = document.getElementById("account-tabs");
  if (!box) return;
  const active = d.selectedAccount; // a key, or null when viewing "all"
  const tabs = (d.accounts || [])
    .map((a) => {
      const on = a.account === active;
      const cal =
        a.calibrationSource === "measured"
          ? ' <span class="dot-cal" title="已实测标定，可换算额度%">●</span>'
          : a.calibrationSource === "derived"
          ? ' <span class="dot-cal derived" title="按 Plus 倍数推算额度%">◐</span>'
          : "";
      return `<button data-acc="${a.account}" class="${on ? "active" : ""}" title="${a.sessions} 个会话 · ${fmt(
        a.billable
      )} 计费 · 最近 ${(a.lastUsed || "").slice(0, 10)}">${accountLabel(a.account)}${cal}</button>`;
    })
    .join("");
  const allTab = `<button data-acc="all" class="${active == null ? "active" : ""}" title="所有账号混合（不换算额度%）">全部</button>`;
  box.innerHTML = tabs + allTab;
}

function setupAccountTabs() {
  const box = document.getElementById("account-tabs");
  if (!box) return;
  box.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    currentAccount = b.dataset.acc;
    try {
      localStorage.setItem("account", currentAccount);
    } catch {}
    tick(); // refetch scoped to the chosen account
  });
}

function render(d) {
  renderAccountTabs(d);

  // machine line
  document.getElementById("machine").textContent =
    `${d.machine.hostname || "本机"} · ${(d.machine.installationId || "").slice(0, 8)} · ` +
    `${d.span.sessions} 个会话 · ${(d.span.first || "").slice(0, 10)} → ${(d.span.last || "").slice(0, 10)}`;

  // windows
  document.getElementById("windows").innerHTML =
    windowCard("5 小时额度窗口", "本机近 5 小时 ", d.windows.fiveHour, false) +
    windowCard("每周额度窗口", "本机近 7 天 ", d.windows.weekly, true);

  // stats
  const t = d.totals;
  const cacheRate = t.input > 0 ? Math.round((t.cached / t.input) * 100) : 0;
  document.getElementById("stats").innerHTML =
    statCard(fmt(t.billable), "本机累计 · 计费 token", `输入(未缓存) ${fmt(t.uncachedInput)} · 输出 ${fmt(t.output)}`) +
    statCard(fmt(d.today.billable), "今日 · 计费 token", `${d.today.events} 次调用`) +
    statCard(fmt(t.cached), "累计缓存命中", `缓存率 ${cacheRate}% · 不计入计费`) +
    statCard(fmt(t.total), "累计原始 token", `含缓存重发 · 仅参考`);

  // daily chart
  const max = Math.max(1, ...d.daily.map((x) => x.billable));
  document.getElementById("chart-max").textContent = `峰值 ${fmt(max)}/天`;
  const todayKey = new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD local
  document.getElementById("chart").innerHTML = d.daily
    .map((day) => {
      const h = (day.billable / max) * 100;
      const isToday = day.date === todayKey;
      return `<div class="bar ${isToday ? "today" : ""}" style="height:${Math.max(1, h)}%">
        <span class="tip">${day.date}<br/>${fmtFull(day.billable)} 计费<br/>缓存 ${fmt(day.cached)}</span>
      </div>`;
    })
    .join("");

  // breakdowns
  const pMax = Math.max(1, ...d.byProject.map((x) => x.billable));
  document.getElementById("byProject").innerHTML = barRows(d.byProject, pMax, "var(--blue)");
  const mMax = Math.max(1, ...d.byModel.map((x) => x.billable));
  document.getElementById("byModel").innerHTML = barRows(d.byModel, mMax, "var(--violet)");

  document.getElementById("foot").textContent =
    `数据源 ~/.codex/sessions · 解析 ${d.parseMs}ms · 更新于 ${new Date(d.generatedAt).toLocaleTimeString("zh-CN", { hour12: false })}`;
}

function setStatus(state, text) {
  const dot = document.getElementById("refresh-dot");
  dot.className = "dot" + (state === "live" ? " live" : state === "err" ? " err" : "");
  document.getElementById("refresh-text").textContent = text;
}

// ---- unit toggle (额度 % <-> token) ----
let lastData = null;

function syncToggleButtons() {
  const box = document.getElementById("unit-toggle");
  if (!box) return;
  for (const b of box.querySelectorAll("button"))
    b.classList.toggle("active", b.dataset.unit === unitMode);
}

function setupToggle() {
  const box = document.getElementById("unit-toggle");
  if (!box) return;
  box.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    unitMode = b.dataset.unit;
    try {
      localStorage.setItem("unitMode", unitMode);
    } catch {}
    syncToggleButtons();
    if (lastData) render(lastData); // re-render immediately, no need to wait for fetch
  });
  syncToggleButtons();
}

async function tick() {
  try {
    const qs = currentAccount ? "?account=" + encodeURIComponent(currentAccount) : "";
    const r = await fetch("/api/usage" + qs, { cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    lastData = await r.json();
    render(lastData);
    setStatus("live", "已同步");
  } catch (e) {
    setStatus("err", "刷新失败: " + e.message);
  }
}

setupToggle();
setupAccountTabs();
tick();
setInterval(tick, REFRESH_MS);
