import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, unlinkSync } from "node:fs";
import path from "node:path";
import { gitSnapshot, gitChanges } from "../src/git.ts";
test("gitChanges reports only paths whose porcelain line changed", () => {
  const cwd = mkdtempSync(path.join(import.meta.dirname, "tmp-"));
  const git = (args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" });
  git(["init"]);
  writeFileSync(path.join(cwd, "a.txt"), "one\n");
  git(["add", "a.txt"]);
  git(["-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-m", "init"]);
  const before = gitSnapshot(cwd);
  writeFileSync(path.join(cwd, "a.txt"), "one\ntwo\n");
  writeFileSync(path.join(cwd, "b.txt"), "new\n");
  const after = gitSnapshot(cwd);
  const changes = gitChanges(cwd, before, after);
  assert.ok(changes);
  assert.equal(changes.files_changed, 2);
  assert.ok(changes.insertions >= 1);
  assert.match(changes.diff_stat, /a\.txt/);
  assert.match(changes.diff_stat, /b\.txt \| untracked \+1/);
  rmSync(cwd, { recursive: true, force: true });
});

test("gitChanges detects content edits to files that stay untracked", () => {
  const cwd = mkdtempSync(path.join(import.meta.dirname, "tmp-"));
  const git = (args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" });
  git(["init"]);
  writeFileSync(path.join(cwd, "u.txt"), "aaa\n");
  const before = gitSnapshot(cwd);
  writeFileSync(path.join(cwd, "u.txt"), "aaa\nbbb\nccc\n");
  const after = gitSnapshot(cwd);
  const changes = gitChanges(cwd, before, after);
  assert.ok(changes);
  assert.equal(changes.files_changed, 1);
  assert.ok(changes.insertions >= 2);
  assert.match(changes.diff_stat, /u\.txt \| untracked/);
  rmSync(cwd, { recursive: true, force: true });
});

test("gitChanges detects dirty tracked edits and changes in nested untracked dirs (issue #30)", () => {
  const cwd = mkdtempSync(path.join(import.meta.dirname, "tmp-"));
  const git = (args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" });
  git(["init"]);
  writeFileSync(path.join(cwd, "README.md"), "# Init\n");
  git(["add", "README.md"]);
  git(["-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-m", "init"]);

  // 1. Pre-dirty a tracked file
  writeFileSync(path.join(cwd, "README.md"), "# Init\npre-edit line\n");

  // 2. Create nested untracked dir with files
  mkdirSync(path.join(cwd, "services/sandbox-gateway/nginx"), { recursive: true });
  writeFileSync(path.join(cwd, "services/sandbox-gateway/docker-compose.yml"), "version: 3\n");
  writeFileSync(path.join(cwd, "services/sandbox-gateway/nginx/conf.txt"), "server {}\n");

  const before = gitSnapshot(cwd);

  // 3. Worker modifies dirty tracked file again
  writeFileSync(path.join(cwd, "README.md"), "# Init\npre-edit line\nworker line\n");

  // 4. Worker adds a new file in untracked dir
  mkdirSync(path.join(cwd, "services/sandbox-gateway/frpc"), { recursive: true });
  writeFileSync(path.join(cwd, "services/sandbox-gateway/frpc/frpc.toml"), "server_addr = 127.0.0.1\n");

  // 5. Worker renames conf.txt to template.txt (delete old, add new)
  unlinkSync(path.join(cwd, "services/sandbox-gateway/nginx/conf.txt"));
  writeFileSync(path.join(cwd, "services/sandbox-gateway/nginx/template.txt"), "server template {}\n");

  const after = gitSnapshot(cwd);
  const changes = gitChanges(cwd, before, after);
  assert.ok(changes);

  // docker-compose.yml unchanged, so 4 files changed:
  // README.md, frpc.toml, conf.txt (deleted), template.txt (added)
  assert.equal(changes.files_changed, 4);
  assert.match(changes.diff_stat, /README\.md/);
  assert.match(changes.diff_stat, /services\/sandbox-gateway\/frpc\/frpc\.toml \| untracked \+1/);
  assert.match(changes.diff_stat, /services\/sandbox-gateway\/nginx\/template\.txt \| untracked \+1/);
  assert.match(changes.diff_stat, /services\/sandbox-gateway\/nginx\/conf\.txt \| untracked deleted/);
  rmSync(cwd, { recursive: true, force: true });
});

