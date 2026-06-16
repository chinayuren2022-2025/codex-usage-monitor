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

## 已切换：SEA 兜底（2026-06-16，MSVC 两次提权失败后启用）

> Tauri 暂缓（用户随时可用 VS Installer GUI 勾「使用 C++ 的桌面开发」后回到 Tauri 路线）。
> 当前用 Node SEA 出免装-Node 的单文件 `.exe`。环境已验证：node v24 + `node:sea` 模块在 ✓，
> npm registry 连通 ✓，可装 build-only 依赖（esbuild/postject，仅构建期，运行时仍零依赖）。

**SEA 架构**：用 esbuild 把 `src/server.mjs`（连同 `parse/aggregate/calibration`）打成单个 CJS，
`public/` 3 个文件作为 SEA assets **嵌进 exe**，注入到 `node.exe` 副本 → 真正单文件 `CodexMonitor.exe`。
运行时检测 `sea.isSea()`：是 exe 就从内嵌 asset 取页面，否则（`npm start`）维持读磁盘 —— 浏览器开发模式不受影响。

**SEA 步骤（每步 commit）**：
- [ ] **A** 计划切到 SEA（本提交）
- [ ] **B** `server.mjs` 加 SEA asset 服务分支（非 SEA 走原磁盘逻辑，零回归）
- [ ] **C** `scripts/build-sea.mjs` 编排（esbuild bundle → sea-config → 生成 blob → 复制 node.exe → postject 注入）+ `package.json` devDeps/`build:exe`
- [ ] **D** `npm i -D esbuild postject` + 跑构建出 `dist/CodexMonitor.exe`
- [ ] **E** 冒烟测试：双击/运行 exe，确认起服务、嵌入页面能打开、`/api/usage` 出真实数据
- [ ] **F** 更新 README（双击 exe、无需 Node）；macOS 同法出二进制（Mac 上跑同一脚本，`.dmg` 可选用 `hdiutil` 套壳）

注：`dist/` 与 `node_modules/` 已在 `.gitignore`，~80MB 的 exe 不入库；交付物在本机 `dist/` + 说明。

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
- 2026-06-16 — S1 探测：winget ✓；MSVC C++ Build Tools ✗（仅有 VS Installer 壳，无 VCTools
  工作负载，`link.exe` 不在 PATH）；rustup ✗。MSVC 工作负载 ~3–5GB 且需管理员(UAC)，
  会话内非交互 shell 无法可靠提权 → **S1 安装交由用户在本机执行**（见下方命令）。等待用户确认。
- 2026-06-16 — S1 首次安装退出码 1。读 VS 安装器日志确认：本次只是 VS Installer 自更新
  （4.4→4.7）+ 注册服务，**VCTools 工作负载未真正安装**（vswhere 无实例、无 `link.exe`）。
  属干净机器首装的「安装器自更新打架」，需用最新安装器**再跑一次**（这次才真正下 ~3–5GB）。
- 2026-06-16 — S1 第二次（`--passive`）仍 exit 1：setup 跑 13s 秒退、未下载 workload，
  包缓存仅 60MB、无进程、无 `link.exe`。判定为**提权失败**（探测确认当前 shell 非管理员；
  `--passive` 安装需 UAC）。MSVC 命令行安装连续两次受阻 → 触发计划中的兜底条件。
  **决定点**：要么用 VS Installer GUI 手动勾「使用 C++ 的桌面开发」（提权最可靠），
  要么切 **SEA 兜底**（零安装、立刻出免装-Node 的 .exe，UI 仍为浏览器）。等用户拍板。
