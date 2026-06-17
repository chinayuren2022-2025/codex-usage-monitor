# 打包成免装-Node 的 .exe / .dmg

> 给**发版的人**看的。普通用户直接去 [Releases](https://github.com/chinayuren2022-2025/codex-usage-monitor/releases) 下载即可，不用读这页。

把应用连同 Node 运行时打成一个自包含可执行文件（基于 [Node SEA](https://nodejs.org/api/single-executable-applications.html)）。只在打包这台机器上需要联网装一次 build 工具（`esbuild` + `postject`，仅构建期用，运行时仍零依赖）；产出的 exe/app 给谁谁都不用装 Node。

```bash
npm install            # 一次性装 build 工具（写入 devDependencies）
npm run build:exe      # 当前系统出包：Windows→dist/CodexMonitor.exe，macOS/Linux→dist/CodexMonitor
```

- **Windows `.exe`**：直接 `npm run build:exe`，得到 `dist/CodexMonitor.exe`（约 88MB，内嵌 `public/` 页面）。
- **macOS `.dmg`**：在 Mac 上跑 `./scripts/build-macos.sh`，构建二进制 → 包成 `CodexMonitor.app`（ad-hoc 签名）→ 封成 `dist/CodexMonitor.dmg`（约 47MB）。已在 Apple Silicon 实测：DMG 挂载 → 拷出 app → `codesign --verify --strict` 通过 → 启动 → HTTP 200 出页面。

> 跨系统说明：exe 只能在 Windows 上构建、dmg 只能在 macOS 上构建（各自的 Node 运行时不同），不能交叉打包。

## 两个 macOS 打包坑（已在脚本里自动处理）

1. **Homebrew 的 node 不能直接做 SEA 基底**。它是个 ~68KB 的小启动器，动态链接 `@rpath/libnode.dylib` + 一堆 `/opt/homebrew` 库；注入 SEA 后在别人机器上会崩。`build-sea.mjs` 用 `otool` 检测到这种动态 node 时，会自动下载**官方静态 node**（仅依赖 `/usr/lib` + 系统框架，真正可移植）作打包基底，缓存在 `dist/sea/`。首次构建需联网拉一次。
2. **不能在 iCloud 同步目录里组装 .app**。iCloud 的 fileprovider 会给 bundle 根目录加 `com.apple.FinderInfo`，导致 codesign 报 "detritus not allowed"、app 留成未签名（在 Apple Silicon 上会闪退）。`build-macos.sh` 在 `$TMPDIR`（非同步的 `/var/folders`）里组装并签名，只把最终 `.dmg` 写回 `dist/`。

## 签名与公证现状

两种产物都**只做 ad-hoc 签名、未公证（notarize）**，所以首次运行有「未知发布者 / 身份不明开发者」提示，按一次性放行即可。要做到双击零提示需 Apple Developer 账号（$99/年）+ `xcrun notarytool` 公证，本项目未做。

## 发 Release（校验和）

```bash
cd dist
shasum -a 256 CodexMonitor.dmg CodexMonitor.exe > SHA256SUMS.txt
gh release create vX.Y.Z CodexMonitor.dmg CodexMonitor.exe SHA256SUMS.txt --title "…" --notes "…" --latest
```
