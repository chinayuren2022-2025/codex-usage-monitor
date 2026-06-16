# codex-usage-monitor 小 Bug 清单

> 审计时间：2026-06-16
> 来源：通读 `src/`、`public/`、`scripts/`、启动器、README、package.json

---

## 1. 用户门槛：队友仍需要“先安装 Node.js”

**位置**：全部 `.cmd` / `.command`

**现象**：现在检测不到 Node 时只是自动打开下载页，没有做到真正的“点击即用”。

**建议**：Windows 上可调用 `winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements`，macOS 上可调用 `brew install node`。如果包管理器不可用，再回退到打开下载页。

**优先级**：中（用户原话是“唯一依赖 node.js？没装的话还想让队友手装吗？”）

---

## 2. macOS 桌面路径未本地化

**位置**：`scripts/export-send.mjs:225`、`export-send.mjs:244`

**现象**：`path.join(os.homedir(), "Desktop", ...)` 在英文系统 OK，但在中文/其他语言 macOS 上桌面目录名不是 `Desktop`，文件会落到 home 根目录里。

**建议**：
- Windows：`path.join(os.homedir(), "Desktop")`
- macOS：优先用 AppleScript / `osascript` 获取真实桌面路径
- 或统一 fallback 到当前工作目录 + 提示

**优先级**：中

---

## 3. fetch-exports.mjs 帮助文本引用了不存在的命令

**位置**：`scripts/fetch-exports.mjs:140`

**现象**：`Use: node src/anchor-snap.mjs --import=<file> to analyze.` 但 `anchor-snap.mjs` 并不支持 `--import`，正确命令是 `node scripts/analyze-export.mjs <file>`。

**优先级**：高（会直接误导用户）

---

## 4. analyze-export.mjs 输出的 calibration.mjs 示例写错了

**位置**：`scripts/analyze-export.mjs:186-187`

**现象**：
```
weekly: w(${fmt(kWeekly)} * 20, "derived")
```
`kWeekly` 已经是 `PLUS_WK * 20` 了，再 `* 20` 就错了。

**建议**：改成 `w(${Math.round(kWeekly).toLocaleString("en-US")}, "derived")` 之类的。

**优先级**：高（用户照抄会写错标定）

---

## 5. receiver.mjs 上传错误时调用了 `ws.close()`

**位置**：`scripts/receiver.mjs:70-71`

**现象**：`WriteStream` 没有 `.close()` 方法，应该用 `.destroy()`。当前代码在错误时可能无法正确释放文件句柄。

**建议**：
```js
ws.destroy();
try { fs.unlinkSync(filePath); } catch {}
```

**优先级**：中

---

## 6. README 仍写“对方需要装 Node.js”

**位置**：`README.md:46`

**现象**：现在启动器已经会自动打开 Node.js 下载页，但 README 描述还是旧的“对方需要装 Node.js，然后双击…”。

**建议**：更新为“双击启动器，若未安装 Node.js 会自动打开下载页面”。

**优先级**：中

---

## 7. package.json 缺少 export 包的打包脚本

**位置**：`package.json:10-13`

**现象**：只有 `package`（打完整 monitor 包），没有打 `codex-export-tool.zip` 的 npm script。

**建议**：新增：
```json
"package:export": "powershell -NoProfile -ExecutionPolicy Bypass -File scripts/make-export-package.ps1"
```

**优先级**：低

---

## 8. export-send.mjs 注释未提及 macOS .command

**位置**：`scripts/export-send.mjs:6-9`

**现象**：注释只写了 `Double-click export-send.cmd on Windows`，没提 macOS。

**建议**：改成 `Double-click export-send.cmd (Windows) or export-send.command (macOS)`。

**优先级**：低

---

## 9. aggregate.mjs 注释未包含 `validated` source

**位置**：`src/aggregate.mjs:269`

**现象**：注释写 `// measured | derived | null`，实际现在还有 `validated`。

**建议**：更新注释为 `// measured | validated | derived | null`。

**优先级**：低

---

## 10. Start-Monitor.command / export-send.command 依赖 bash

**位置**：`Start-Monitor.command:1`、`scripts/export-send.command:1`

**现象**：`#!/bin/bash`。macOS 默认 shell 是 zsh，虽然 bash 仍预装，但未来版本可能移除。用 `#!/bin/sh` 更稳（脚本里没有 bash 特有语法）。

**优先级**：低

---

## 11. receiver.mjs 下载链接在 HTML 中未做 XSS 转义

**位置**：`scripts/receiver.mjs:92-142`

**现象**：`f.name` 直接拼进 HTML，虽然文件名由服务端生成且只允许 `codex-export-<machineId>-<date>.json.gz`，但防御性编码应转义 `&`、`"`、`>`、`<`。

**建议**：加一个简单的 `escapeHtml` 函数。

**优先级**：低

---

## 12. export-send.mjs 文件名用了原始 hostname

**位置**：`scripts/export-send.mjs:223`

**现象**：`outName = codex-export-${host}-${machineId}-${Date.now()}.json.gz`，如果 hostname 含特殊字符（如中文、空格、反斜杠），Windows 文件名可能不合法。

**建议**：对 `host` 做 sanitize：`host.replace(/[^a-zA-Z0-9_-]/g, "_")`。

**优先级**：中

---

## 13. receiver.mjs 没有限制上传文件名/路径注入

**位置**：`scripts/receiver.mjs:148-166`

**现象**：`serveDownload` 只检查了 `.json.gz`，但 `path.basename(decodeURIComponent(...))` 可以防御路径遍历，算 ok。不过文件名仍可能超长。

**建议**：限制文件名长度，比如 200 字符。

**优先级**：低

---

## 14. fetch-exports.mjs 没有 `--server` / `--help` 参数

**位置**：`scripts/fetch-exports.mjs`

**现象**：服务端地址只能通过 `RECEIVER_URL` 环境变量改，不像 `export-send.mjs` 有 `--server=` 参数。使用体验不一致。

**建议**：支持 `node fetch-exports.mjs --server=https://x.x.x.x/codex-export`。

**优先级**：低

---

## 15. server.mjs 同步 IO 处理静态资源

**位置**：`src/server.mjs:49-51`

**现象**：每个静态请求都调用 `fs.existsSync` + `fs.statSync` + `fs.createReadStream`。本地用 ok，但严格说应该用异步或至少缓存目录内容。

**建议**：暂不处理，本地仪表盘无妨。记录即可。

**优先级**：低

---

## 16. app.js `windowCard` 的 `provisional` 参数硬编码

**位置**：`public/app.js:222-224`

**现象**：
```js
windowCard("5 小时额度窗口", ..., false) +
windowCard("每周额度窗口", ..., true)
```

`provisional` 逻辑未与后端数据联动，weekly 窗口的“估算”标签永远显示，即使 pro weekly 是 derived（倍数推算）也有专门的 `derived` 标签。这里传 `true` 会导致 weekly 窗口多出一个“额度为估算”标签，和 `derived` 重复。

**建议**：移除 `provisional` 参数或让它由后端 `calibrationSource` 决定。

**优先级**：中

---

## 17. .command 文件在 zip 中执行位丢失问题

**位置**：`make-package.ps1`、`make-export-package.ps1`

**现象**：PowerShell `Compress-Archive` 不保存 Unix 执行位，队友解压后 `.command` 可能双击无反应。

**建议**：`.command` 文件已加了自修复逻辑，但 README 里仍保留 `chmod +x` 说明。已在脚本中自修复，算 ok。可记录为“ mitigated”。

**优先级**：低

---

## 总结

| 优先级 | 数量 | 主要项 |
|--------|------|--------|
| 高 | 2 | fetch-exports 帮助文本错误、analyze-export 标定示例错误 |
| 中 | 6 | Node 仍需手动安装、macOS 桌面路径、README 过时、receiver ws.close、hostname 文件名、weekly provisional 标签重复 |
| 低 | 9 | 其余文档/注释/小优化项 |

**建议交付前至少修掉“高”和“中”项。**
