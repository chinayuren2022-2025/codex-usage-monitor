# Codex 用量监控 (codex-usage-monitor)

本地网页仪表盘，监控**这台机器**消耗的 Codex token，用于**拼车 / 共享账户**的额度监控。
灵感来自 [ccusage](https://github.com/ryoppippi/ccusage)（它做的是 Claude Code），本项目针对 OpenAI Codex。

零依赖，纯 Node 内置模块。数据来源：`~/.codex/sessions/**/*.jsonl`（Codex 自己写的会话日志）。

## 点击即用（Windows）

双击桌面的 **「Codex Usage Monitor」** 快捷方式，或项目里的 **`Start-Monitor.cmd`**。
会自动选一个空闲端口启动、自动打开浏览器。**关掉那个黑色窗口就停止监控**。
（快捷方式名用英文是为了跨机器不乱码；网页界面仍是中文。）

快捷方式若丢了，重新生成：

```powershell
powershell -NoProfile -File "scripts\install-shortcut.ps1"
```

## 命令行运行

```bash
npm start              # 启动网页并自动打开浏览器（端口被占会自动顺延）
PORT=9000 npm start    # 指定起始端口
NO_OPEN=1 npm start    # 不自动开浏览器
npm run report         # 不开网页，直接终端打印报表
```

页面每 15 秒自动刷新。

## 分享给拼车队友

把整个 `codex-usage-monitor` 文件夹拷给对方即可（每人看自己机器的用量）。
对方需要装 [Node.js](https://nodejs.org)，然后双击 `Start-Monitor.cmd`，
首次会自己在桌面建快捷方式。无需 `npm install`（零依赖）。

## 看什么

- **5 小时窗口 / 每周窗口**：
  - 圆环 = **账户整体**已用百分比（直接读 Codex 的 meter，精确，这是拼车会撞墙的共享资源）。
  - 大数字 = **本机占该额度池的比例**（拼车最关心的指标）。
  - 进度条 = 把"账户已用"拆成 **本机** + **其他**（队友 / fast mode / cloud / 你看不见的消耗）。
  - 「占已用 N%」= 已经烧掉的额度里，本机占了多少。
- **本机累计 / 今日**：这台机器一共/今天烧了多少**计费** token（成本视角）。
- **每日柱状图**：近 30 天逐日消耗。
- **按项目 / 按模型**：钱花在哪个目录、哪个模型上。

## 两套口径：成本（billable）vs 额度（total）

经过一次受控标定（2026-06-11，干净的单人 Plus 账号）发现：**额度 meter 是按「总 token，含 cached」扣的，不是 billable。**

- **billable** = (input − cached) + output → 衡量**花多少钱**（cached 计费打折）。头条统计、按项目/模型仍用它。
- **total** = input + output（含 cached）→ 衡量**占多少额度 / 谁容易把大家撞墙**。窗口卡片的占比用它。

证据两条：①一个烧 180K billable、几乎无缓存的回合只把 5h 推了 ~2 点，而一个 25K billable、9K 缓存的回合几乎没推动——只有"按 total"能同时解释。②"5h 每涨 1 点时 weekly 涨几点"在缓存比例剧烈变化时仍恒定 ≈6.4，说明两个窗口同口径。

标定常数与完整溯源见 `src/calibration.mjs`。重标工具：`node src/anchor-snap.mjs [--account=<档位>]`（分析最近一段会话，自动报直接法/比值法/队友污染%）。

**已知局限**：占比是**估算**——5h 池标定较硬，weekly 池靠 5h 按 6.4x 推算（约 ±10%）；且只标定了一个模型/regime，模型混用时占比会有偏差。账户"已用%"本身永远精确，不受影响。

## 多账号（在同一台机器上切换过不同账号）

如果你在这台机器上登录过**多个 Codex 账号**（比如拼车号、自己的号、借来的号），日志会混在一起。本工具用每条额度事件里的 **`plan_type`** 字段把它们分开：

- 顶部**账号标签栏**可切换：选某个账号，整个面板只显示**那个账号在本机的消耗**。`全部` = 混合。选择会被记住。
- 标记含义：**●** = 已实测标定（Plus）；**◐** = 推算/粗标（按套餐倍数推算，或比值法粗标定）；无标记 = 未标定（team/unknown），只显示精确 token、% 标"未标定"。每个窗口单独标注口径：`估算`(实测) / `推算`(倍数) / `粗标`(比值法)。
- 套餐结构（用户提供）：weekly 池 Pro=Plus×20、Pro Lite=Plus×5。**5h 池不是同一倍数**——Pro 的 5h 实测约 45×Plus（≈770M，用下述比值法粗标，约±40%，会随用量收紧）。都写在 `src/calibration.mjs`。
- **共享账号怎么标定（抗污染比值法）**：拼车号上队友会一起推高额度表，没法用"独占"假设。但 5h 和 weekly 数的是同一批 token，所以 `k_5h = k_weekly_已知 × Δweekly%/Δ5h%`——队友的消耗在比值里抵消掉。`node src/anchor-snap.mjs --account=pro` 会同时报"直接法/比值法/队友污染%"，污染高时看比值法。
- 命令行：`npm run report -- --account=pro`（默认 `all` 全量）。

**限制**：`plan_type` 只能区分**档位**（plus/pro/prolite/team），**区分不了两个同档账号**（比如两个 Plus）——Codex 的日志里没有账号 ID/邮箱。同档的只能靠时间段手动切。

## 数据模型（已核验）

每个 `rollout-*.jsonl` 里：

- `session_meta`（首行，`type` 在顶层）：`cwd` / `cli_version` / `source` / 开始时间。
- `token_count`（包在 `{type:"event_msg", payload:{type:"token_count"}}` 里）：
  - `info.last_token_usage`：**该回合**的用量（input/cached/output/reasoning/total）。
  - `info.total_token_usage`：会话累计。
  - `rate_limits.primary`（5 小时窗口）/ `secondary`（每周窗口）：`used_percent` + `resets_at`（unix 秒），这是**账户整体**额度。

核验过的事实（用于聚合的前提）：

- `total = input + output`，且 `input` 已包含 `cached`（不能再加一遍）；`reasoning ⊆ output`。
- 一个会话内 `sum(last_token_usage) == 最终的 total_token_usage`（精确相等）。
  所以直接按每个事件的 `last_token_usage` + 它自己的时间戳分桶即可，**无需担心上下文压缩导致的累计值回退**。

## 窗口口径与已知局限

- 窗口用量按账户真实的重置边界对齐：`窗口起点 = resets_at - window_minutes`，这样本机 token 数和账户 `used_percent` 对得上。
- **账户额度百分比是「快照」，不是实时的**：它只到本机最后一次 `token_count` 事件为止（页面标注「账户额度截至 …」）。如果本机几天没跑 Codex，这个百分比反映不了队友期间的消耗。本机 token 数回答「是不是我用的」，账户百分比回答「离撞墙还有多远」。
- 多机汇总（把每台机器的本机用量拼到一起）尚未实现，目前是单机视角。

## 结构

```
src/parse.mjs      扫描 + 流式解析 jsonl，按 mtime/size 缓存（历史文件只解析一次）
src/aggregate.mjs  聚合成仪表盘数据（计费口径、窗口、每日、按项目/模型）
src/server.mjs     零依赖 http 服务 + /api/usage
src/cli.mjs        终端报表
public/            前端（原生 JS，无框架）
```

数据全部本地读取，不联网、不上报。
