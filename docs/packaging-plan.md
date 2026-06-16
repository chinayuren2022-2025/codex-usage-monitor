# 打包为桌面应用计划 (.exe / .dmg) — Tauri

> 创建：2026-06-16 · 目标：把当前「本地 Node 服务 + 浏览器」改造成可双击的桌面 App，
> 队友无需安装 Node。Windows 出 `.exe`，macOS 由用户在自己的 Mac 上出 `.dmg`。

---

## 决策（已与用户确认）

| 项 | 选择 | 理由 |
|----|------|------|
| UI 呈现 | **Tauri 原生窗口** | 独立桌面窗口，复用现有 `public/` 的 HTML/CSS/JS，不重写界面 |
| 数据逻辑 | **复用现有 Node 代码**（`parse`/`aggregate`/`calibration`），不重写 Rust | 已测试、含标定数学，重写风险大 |
| 集成方式 | Tauri 把 **Node 运行时 + JS 作为 sidecar**，`invoke` 一次性取 JSON | 免端口、免常驻 HTTP server |
| 浏览器模式 | **保留**（`npm start` 不受影响） | 开发/调试仍可用浏览器 |
| macOS | 提供 `scripts/build-macos.sh`，用户在 Mac 上出 `.dmg` | 本机 Windows 无法构建 macOS 包 |

## 环境现状（2026-06-16 实测）

- Node `v24.14.1` ✓ · npm `11.13.0` ✓
- Rust / cargo ✗ **未安装**（Tauri 必需）
- WebView2 Runtime ✓ 已检测到（注册表命中 WebView2 GUID）

---

## 架构

```
Tauri App (Rust 外壳)
  ├─ 主窗口 WebView ──► public/index.html   （现有 UI；app.js 改成双模式）
  └─ Rust command get_usage()
        └─ spawn sidecar(node) cli.mjs --json ──► stdout 一次性 JSON ──► 前端
sidecar = 随包携带的 node 运行时（externalBin），目标机无需装 Node
```

前端取数双模式：检测到 `window.__TAURI__` → 用 `invoke('get_usage')`；
否则（浏览器）→ 维持现有 `fetch('/api/usage')`。两条路返回同一份 JSON。

---

## 步骤（每步一个 commit，逐步 sync）

- [x] **S0** 写本计划并提交
- [ ] **S1** 安装 Rust 工具链（rustup + MSVC build tools）— ⚠️ 重/可能需交互，先与用户确认
- [ ] **S2** 给 `cli.mjs` 加 `--json` 一次性模式：输出与 `/api/usage` 完全一致的 aggregate JSON
- [ ] **S3** `app.js` 适配双模式（`__TAURI__` 用 invoke，否则 fetch），不破坏浏览器路径
- [ ] **S4** scaffold `src-tauri/`：窗口标题/尺寸/图标、`externalBin` 配 node sidecar、`resources` 带 `src/` `public/`
- [ ] **S5** Rust 侧 `get_usage` command：spawn sidecar 跑 `cli.mjs --json`，回传 stdout
- [ ] **S6** 本机 `cargo tauri build` 出 `.exe` + 冒烟测试（启动、显示真实用量、15s 刷新）
- [ ] **S7** 写 `scripts/build-macos.sh` + 更新 README（双击即用、无需 Node）
- [ ] **S8**（可选）GitHub Actions：tag 触发自动出 `.exe` + `.dmg`

---

## 风险 / 待确认

1. **Rust + MSVC 安装很重**：Windows 上 Tauri 需要 MSVC C++ build tools（`link.exe`），
   可能是 GB 级、需交互的安装器。若 bash 工具装不动，需用户用 `! <cmd>` 在会话里跑。
2. **sidecar 体积**：随包带 node 运行时（~80MB），Tauri 总包会偏大。先求能用，
   后续可选用 Node SEA 把 `cli.mjs` 打成单文件二进制压体积。
3. **`.dmg` 本机出不了**：必须在 macOS 上构建（用户已表示有 Mac，走 `build-macos.sh`）。
4. **代码签名/公证**：未签名的 `.exe`/`.dmg` 在对方机器会有安全提示。本轮先不签名，
   README 说明「右键→打开」绕过即可，签名留作后续。

---

## 进度日志

- 2026-06-16 — S0：计划成文并提交。
