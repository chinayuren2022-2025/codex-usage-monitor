#!/usr/bin/env node
// Build a single-file executable via Node SEA (Single Executable Applications).
//
//   node scripts/build-sea.mjs       → dist/CodexMonitor.exe (win) / CodexMonitor (mac/linux)
//
// Teammates run the produced binary by double-click; NO Node install required.
// Build-only deps: esbuild + postject (devDependencies). The shipped app stays
// zero-runtime-dependency — these tools only run at build time on the packager's
// machine. public/ is embedded into the binary as SEA assets (see src/server.mjs).
import { build } from "esbuild";
import { inject } from "postject";
import pngToIco from "png-to-ico";
import { rcedit } from "rcedit";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const seaDir = path.join(dist, "sea");
fs.mkdirSync(seaDir, { recursive: true });

const isWin = process.platform === "win32";
const isMac = process.platform === "darwin";
const exeName = isWin ? "CodexMonitor.exe" : "CodexMonitor";
const outExe = path.join(dist, exeName);
const bundlePath = path.join(seaDir, "server.cjs");
const blobPath = path.join(seaDir, "sea-prep.blob");
const cfgPath = path.join(seaDir, "sea-config.json");
const FUSE = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";

const step = (n, msg) => console.log(`\n[${n}/5] ${msg}`);

// 1. Bundle the ESM app (server + parse + aggregate + calibration) into one CJS
//    file. SEA runs its main as CommonJS, so a single bundled file is required.
step(1, "bundling app -> single CJS");
await build({
  entryPoints: [path.join(root, "src", "server.mjs")],
  outfile: bundlePath,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  logLevel: "info",
});

// 2. Register every public/ file as a SEA asset (embedded into the binary).
step(2, "writing sea-config.json (embedding public/)");
const publicDir = path.join(root, "public");
const assets = {};
for (const f of fs.readdirSync(publicDir)) {
  const fp = path.join(publicDir, f);
  if (fs.statSync(fp).isFile()) assets[f] = fp; // key = filename, served by server.mjs
}
const cfg = {
  main: bundlePath,
  output: blobPath,
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: false,
  assets,
};
fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
console.log("  embedded assets:", Object.keys(assets).join(", "));

// 3. Generate the SEA preparation blob.
step(3, "generating SEA blob");
execFileSync(process.execPath, ["--experimental-sea-config", cfgPath], { stdio: "inherit", cwd: root });

// 4. Copy the running Node binary as the base executable.
step(4, `copying node runtime -> ${exeName}`);
fs.copyFileSync(process.execPath, outExe);
// macOS rejects a modified signed binary; strip the signature before injecting.
if (isMac) {
  try { execFileSync("codesign", ["--remove-signature", outExe], { stdio: "inherit" }); } catch {}
}

// 4b. Windows: stamp the app icon + version metadata onto the exe (rcedit). The
//     icon source lives in assets/; macOS gets its icon via build-macos.sh.
const iconPng = path.join(root, "assets", "icon.png");
if (isWin && fs.existsSync(iconPng)) {
  console.log("      stamping icon + metadata (rcedit)");
  const icoPath = path.join(seaDir, "icon.ico");
  fs.writeFileSync(icoPath, await pngToIco(iconPng));
  await rcedit(outExe, {
    icon: icoPath,
    "file-version": "0.1.0.0",
    "product-version": "0.1.0.0",
    "version-string": {
      ProductName: "Codex Usage Monitor",
      FileDescription: "Codex Usage Monitor",
      CompanyName: "codex-usage-monitor",
      LegalCopyright: "MIT",
      OriginalFilename: exeName,
    },
  });
}

// 5. Inject the blob into the binary copy.
step(5, "injecting blob (postject)");
const blob = fs.readFileSync(blobPath);
await inject(outExe, "NODE_SEA_BLOB", blob, {
  sentinelFuse: FUSE,
  machoSegmentName: isMac ? "NODE_SEA" : undefined,
});
// Re-sign ad-hoc on macOS so Gatekeeper will run it locally.
if (isMac) {
  try { execFileSync("codesign", ["--sign", "-", outExe], { stdio: "inherit" }); } catch {}
}

const sizeMB = (fs.statSync(outExe).size / 1024 / 1024).toFixed(1);
console.log(`\nDone -> ${outExe}  (${sizeMB} MB)`);
console.log("Run it (double-click) to start the monitor. No Node.js required on the target machine.");
