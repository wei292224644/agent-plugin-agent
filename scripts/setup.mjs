#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Scope is split so this file never names an import. It must load when dependencies are missing.
const SCOPE = "@" + "modelcontextprotocol";
const PACKAGES = [
  [SCOPE, "sdk"],
  ["zod"],
];

function npmBin() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

export function scriptPluginRoot(metaUrl = import.meta.url) {
  return path.resolve(path.dirname(fileURLToPath(metaUrl)), "..");
}

export function npmAvailable(spawnImpl = spawnSync) {
  return spawnImpl(npmBin(), ["--version"], { encoding: "utf8" }).status === 0;
}

function packageName(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).name || null;
  } catch {
    return null;
  }
}

export function depsInstalled(root) {
  return PACKAGES.every((parts) =>
    fs.existsSync(path.join(root, "node_modules", ...parts, "package.json")),
  );
}

export function inspect(root, spawnImpl = spawnSync) {
  const name = packageName(root);
  const baton = name === "baton";
  const installed = baton && depsInstalled(root);
  const npm = npmAvailable(spawnImpl);
  let next;
  if (!baton) next = "这个目录不是 baton 插件（package.json name 不是 baton）。";
  else if (installed) next = "依赖已在。工具列表里还没有 delegate_task 的话，重载插件后再开一次会话。";
  else if (!npm) next = "没有 npm。先装 Node.js 18 或更新，再跑 /baton:setup。";
  else next = "依赖未安装。确认后只在这个插件目录执行 npm ci，不要装到用户项目里。";
  return {
    plugin_root: root,
    package: name,
    npm,
    deps_installed: installed,
    ready: installed,
    next,
  };
}

export function installDeps(root, spawnImpl = spawnSync) {
  const lock = fs.existsSync(path.join(root, "package-lock.json"));
  const args = lock ? ["ci", "--omit=dev"] : ["install", "--omit=dev"];
  const result = spawnImpl(npmBin(), args, { cwd: root, encoding: "utf8" });
  return {
    ok: result.status === 0,
    command: ["npm", ...args].join(" "),
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

function parseArgs(argv) {
  const out = { install: false, root: null };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--install") out.install = true;
    else if (token === "--json") out.json = true;
    else if (token === "--root") out.root = argv[(i += 1)];
  }
  return out;
}

export function main(argv = process.argv.slice(2), spawnImpl = spawnSync) {
  const args = parseArgs(argv);
  const root = path.resolve(args.root || scriptPluginRoot());
  if (!args.install) return inspect(root, spawnImpl);
  const before = inspect(root, spawnImpl);
  if (!before.ready && before.package === "baton") {
    const ran = installDeps(root, spawnImpl);
    const after = inspect(root, spawnImpl);
    const tail = `${ran.stderr || ran.stdout || ""}`.trim().slice(-2000);
    const ok = ran.ok && after.ready;
    return {
      ...after,
      installed: ok,
      command: ran.command,
      ...(ok ? {} : { error: tail || "npm 安装失败。" }),
      next: ok ? "依赖已装上。重载插件，让 MCP 重新启动。" : tail || after.next,
    };
  }
  return { ...before, installed: false };
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  process.stdout.write(`${JSON.stringify(main(), null, 2)}\n`);
}
