# 打包为桌面应用计划 (.exe / .dmg) — Tauri

> 创建：2026-06-16 · 目标：把当前「本地 Node 服务 + 浏览器」改造成可双击的桌面 App，
> 队友无需安装 Node。Windows 出 `.exe`，macOS 由用户在自己的 Mac 上出 `.dmg`。

---

## 决策（已与用户确认）

| 项 | 选择 | 理由 |
|----|------|------|
| UI 呈现 | **Tauri 原生窗口** | 独立桌面窗口，复用现有 `public/` 的 HTML/CSS/JS，不重写界面 |
| 数据逻辑 | **复用现有 Node 代码**（`parse`/`aggregate`/`calibration`），不重写 Rust | 已测试、含标定数学，重写风险大 |
| 集成方式 | Tauri 把 **现有 `server.mjs` 当作常驻 sidecar**，WebView 指向 `localhost:PORT` | `server.mjs` 和 `app.js` **都不用改**，新代码最少 |
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
  ├─ 启动时：Rust 选一个空闲端口 → spawn sidecar(node) server.mjs PORT
  │            └─ 等 server 监听就绪（轮询/重试）
  └─ 主窗口 WebView ──► http://localhost:PORT  （现有 UI 原样加载）
sidecar = 随包携带的 node 运行时（externalBin）+ src/、public/（resources），目标机无需装 Node
```

关键：复用现有 `server.mjs`（已支持 `PORT` via argv/env）和 `app.js`，**两者都不改**。
唯一成本是启动时要等 server 就绪再加载 WebView（重试几次）。
（备选「一次性 `--json` invoke」需改 `app.js` 双模式 + 新增 `--json`，代码更多，不采用。）

---

## 步骤（每步一个 commit，逐步 sync）

> 调整（采纳 advisor 建议）：**先证明工具链能 build，再写集成代码**。最大未知数不是代码，
> 而是这台机器能不能 link（MSVC）。否则 S4/S5 会基于一个跑不通的 build 白写。

- [x] **S0** 写本计划并提交
- [ ] **S1** 安装 Rust 工具链（`rustup -y` + MSVC C++ Build Tools）— ⚠️ MSVC 是 GB 级、可能需交互
- [ ] **S2 [GATE]** 工具链冒烟：`npm create tauri-app`(vanilla) → `tauri build` → 确认真出 `.exe`。
      过不了就立刻告知用户（他用 `!` 跑安装器），或回退 **Node SEA**（零 Rust，也能出 `.exe`）
- [ ] **S3** scaffold 本项目 `src-tauri/`：窗口标题/尺寸/图标；`externalBin` 配 node sidecar；
      `resources` 带 `src/`、`public/`
- [ ] **S4** Rust 侧：启动选空闲端口 → spawn `node server.mjs PORT` → 等监听就绪 → WebView 指向它
      （`server.mjs`、`app.js` 均不改）
- [ ] **S5** 本机 `cargo tauri build` 出 `.exe` + 冒烟测试（启动、显示真实用量、15s 刷新）
- [ ] **S6** 写 `scripts/build-macos.sh`（本机无法测，需 echo 每步、fail loud）+ 更新 README
- [ ] **S7**（可选）GitHub Actions：tag 触发自动出 `.exe` + `.dmg`

**回退方案**：若 S2 证明 MSVC 装不动 → 改用 Node SEA 把 `server.mjs` 打成单文件 `.exe`（零 Rust，
仍解决「队友免装 Node」的核心痛点，但 UI 仍是浏览器、非原生窗口）。不重新讨论 Tauri 选型，仅作兜底。

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
- 2026-06-16 — 采纳 advisor：改为「先证明工具链再写集成」；sidecar 改用现有 `server.mjs`
  （`server.mjs`/`app.js` 不改）；SEA 列为 MSVC 装不动时的兜底。
