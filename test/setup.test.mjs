import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { depsInstalled, installDeps, main, scriptPluginRoot } from "../scripts/setup.mjs";

function batonRoot(name = "baton") {
  const root = mkdtempSync(path.join(os.tmpdir(), "baton-setup-"));
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ name }));
  return root;
}

function markInstalled(root) {
  for (const parts of [
    ["@modelcontextprotocol", "sdk"],
    ["zod"],
  ]) {
    const dir = path.join(root, "node_modules", ...parts);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "package.json"), "{}");
  }
}

test("setup inspects plugin deps without importing the SDK", () => {
  const src = readFileSync(new URL("../scripts/setup.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(src, /@modelcontextprotocol|mcp\.mjs|cli\.mjs/);
  assert.equal(scriptPluginRoot(), path.resolve(import.meta.dirname, ".."));

  const empty = batonRoot();
  const npmOk = () => ({ status: 0, stdout: "", stderr: "" });
  try {
    const missing = main(["--json", "--root", empty], npmOk);
    assert.equal(missing.ready, false);
    assert.equal(missing.npm, true);
    assert.equal(missing.package, "baton");

    markInstalled(empty);
    assert.equal(depsInstalled(empty), true);
    assert.equal(main(["--root", empty], npmOk).ready, true);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});

test("setup install stays inside a baton plugin root", () => {
  const other = batonRoot("not-baton");
  const locked = batonRoot();
  const unlocked = batonRoot();
  writeFileSync(path.join(locked, "package-lock.json"), "{}");
  const calls = [];
  const spawnImpl = (cmd, args, opts = {}) => {
    calls.push({ cmd, args, cwd: opts.cwd });
    if (args[0] === "--version") return { status: 0, stdout: "10\n", stderr: "" };
    markInstalled(opts.cwd);
    return { status: 0, stdout: "", stderr: "" };
  };
  try {
    const refused = main(["--install", "--root", other], spawnImpl);
    assert.equal(refused.installed, false);
    assert.equal(calls.some((call) => call.args[0] === "ci" || call.args[0] === "install"), false);

    const withLock = main(["--install", "--root", locked], spawnImpl);
    assert.equal(withLock.installed, true);
    assert.deepEqual(
      calls.filter((call) => call.cwd === locked).map((call) => call.args),
      [["ci", "--omit=dev"]],
    );

    calls.length = 0;
    installDeps(unlocked, spawnImpl);
    assert.deepEqual(calls[0].args, ["install", "--omit=dev"]);
    assert.equal(calls[0].cwd, unlocked);
  } finally {
    rmSync(other, { recursive: true, force: true });
    rmSync(locked, { recursive: true, force: true });
    rmSync(unlocked, { recursive: true, force: true });
  }
});

test("setup skill is /baton:setup", () => {
  const skill = readFileSync(path.join(import.meta.dirname, "../skills/setup/SKILL.md"), "utf8");
  assert.match(skill, /^name:\s*setup\s*$/m);
  assert.match(skill, /安装依赖 \(Recommended\)/);
  assert.match(skill, /暂时跳过/);
});
