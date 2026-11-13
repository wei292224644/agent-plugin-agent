import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { sandbox, exec, cli, sleep } from "./helpers.ts";

test("wait --for 1 到点返回 running，支持多任务任一完成及已完成任务", async (t) => {
  const s = sandbox(t);
  s.env.FAKE_HANG = "1";
  const slow = await s.run("start", "--target", "codex", "--prompt", "slow");
  const begin = performance.now();
  const waiting = await s.run("wait", slow.task_id, "--for", "1");
  const elapsed = performance.now() - begin;
  assert.equal(waiting.status, "running");
  assert.ok(elapsed >= 1000 && elapsed < 3000, `耗时 ${elapsed}ms`);
  s.env.FAKE_HANG = "0";
  s.env.FAKE_SLEEP = "0.4";
  const quick = await s.run("start", "--target", "codex", "--prompt", "quick");
  const done = await s.run("wait", slow.task_id, quick.task_id, "--for", "3");
  assert.equal(done.task_id, quick.task_id);
  assert.equal(done.status, "success");
  assert.equal((await s.run("wait", quick.task_id, "--for", "1")).status, "success");
  await s.run("cancel", slow.task_id);
  for (const args of [["wait"], ["wait", quick.task_id, "--for", "-1"], ["wait", quick.task_id, "../x"]]) await assert.rejects(s.run(...args));
});

test("tail 人读与 raw 输出；-f 在结束后退出且包含最后一个事件", async (t) => {
  const s = sandbox(t);
  s.env.FAKE_SLEEP = "0.5";
  const task = await s.run("start", "--target", "codex", "--prompt", "watch");
  const follower = spawn(process.execPath, [cli, "tail", task.task_id, "-f"], { cwd: s.cwd, env: s.env, stdio: ["ignore", "pipe", "pipe"] });
  t.after(() => follower.kill("SIGKILL"));
  let output = "";
  follower.stdout.on("data", (chunk) => { output += String(chunk); });
  const finished = new Promise((resolve, reject) => { follower.on("close", resolve); follower.on("error", reject); });
  await sleep(150);
  assert.match(output, /watch/);
  assert.equal(s.meta(task.task_id).status, "running");
  await s.until(task.task_id);
  await finished;
  assert.match(output, /ok/);
  assert.match(output, /success/);
  const raw = await exec(process.execPath, [cli, "tail", task.task_id, "--raw"], { cwd: s.cwd, env: s.env });
  assert.equal(raw.stdout, fs.readFileSync(path.join(s.dir(task.task_id), "events.jsonl"), "utf8"));
  const human = await exec(process.execPath, [cli, "tail", task.task_id], { cwd: s.cwd, env: s.env });
  assert.match(human.stdout, /第 1 轮/);
  await assert.rejects(s.run("tail", "../x"));
});

test("ls 按 cwd 筛选、按更新时间倒序；prune 只删过期的非 running 任务", async (t) => {
  const s = sandbox(t);
  const { randomUUID } = await import("node:crypto");
  const first = await s.run("start", "--target", "codex", "--prompt", "done");
  const done = await s.until(first.task_id);
  const old = new Date(Date.now() - 10 * 86_400_000).toISOString();
  const recent = new Date(Date.now() - 1000).toISOString();
  const other = randomUUID();
  const decision = randomUUID();
  const failed = randomUUID();
  for (const meta of [
    { ...done, updated_at: recent },
    { ...done, task_id: other, cwd: path.join(s.home, "elsewhere"), updated_at: old },
    { ...done, task_id: decision, status: "needs_input", updated_at: old },
    { ...done, task_id: failed, status: "failed", updated_at: old },
  ]) {
    fs.mkdirSync(s.dir(meta.task_id), { mode: 0o700, recursive: true });
    fs.writeFileSync(path.join(s.dir(meta.task_id), "meta.json"), JSON.stringify(meta), { mode: 0o600 });
  }
  s.env.FAKE_HANG = "1";
  const running = await s.run("start", "--target", "codex", "--prompt", "keep running");
  await s.until(running.task_id, (m) => !!m.session_id);
  await sleep(50);
  fs.writeFileSync(path.join(s.dir(running.task_id), "meta.json"), JSON.stringify({ ...s.meta(running.task_id), updated_at: old }));
  const listed = await s.run<{ tasks: { task_id: string; liveness?: string }[] }>("ls");
  assert.equal(listed.tasks[0].task_id, first.task_id);
  assert.ok(!listed.tasks.some((m) => m.task_id === other));
  assert.equal(listed.tasks.find((m) => m.task_id === running.task_id)?.liveness, "active");
  const all = await s.run<{ tasks: { task_id: string }[] }>("ls", "--all");
  assert.equal(all.tasks.length, 5);
  const pruned = await s.run<{ deleted: string[] }>("prune", "--older", "5");
  assert.deepEqual(pruned.deleted.sort(), [other, decision, failed].sort());
  assert.ok(fs.existsSync(s.dir(first.task_id)));
  assert.ok(fs.existsSync(s.dir(running.task_id)));
  assert.equal(s.meta(running.task_id).status, "running");
  assert.deepEqual((await s.run<{ deleted: string[] }>("prune", "--older", "5")).deleted, []);
  await s.run("cancel", running.task_id);
  for (const args of [["prune"], ["prune", "--older", "-1"], ["prune", "--older", "NaN"], ["ls", "extra"]]) await assert.rejects(s.run(...args));
});

test("终态 status/wait 带上当前轮的 git_changes", async (t) => {
  const s = sandbox(t);
  for (const args of [["init", "-q"], ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init"]]) await exec("git", args, { cwd: s.cwd, env: s.env });
  const started = await s.run("start", "--target", "codex", "--prompt", "hi");
  const done = await s.run<Record<string, any>>("wait", started.task_id, "--for", "5");
  assert.equal(done.status, "success");
  assert.deepEqual(done.git_changes, s.turn(started.task_id).git_changes);
  assert.equal(done.git_changes?.files_changed, 0);
  assert.deepEqual((await s.run<Record<string, any>>("status", started.task_id)).git_changes, done.git_changes);
});
