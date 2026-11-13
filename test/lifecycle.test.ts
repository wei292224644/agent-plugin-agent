import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { sandbox, exec, cli, sleep } from "./helpers.ts";
import type { TaskMeta } from "../src/types.ts";

test("start 在 1s 内返回，SIGKILL 发起父进程后 supervisor 仍写出 success", async (t) => {
  const s = sandbox(t);
  s.env.FAKE_SLEEP = "0.5";
  const parent = spawn(process.execPath, [path.join(import.meta.dirname, "fake-cli/start-parent.ts")], { cwd: s.cwd, env: s.env, stdio: ["ignore", "pipe", "pipe"] });
  t.after(() => parent.kill("SIGKILL"));
  let text = "";
  const startedAt = performance.now();
  const started = await new Promise<TaskMeta>((resolve, reject) => {
    parent.stdout.on("data", (chunk) => { text += chunk; if (text.includes("\n")) resolve(JSON.parse(text.trim())); });
    parent.stderr.on("data", (chunk) => reject(new Error(String(chunk))));
    parent.on("error", reject);
    parent.on("exit", (code) => { if (!text) reject(new Error(`parent exited ${code}`)); });
  });
  assert.ok(performance.now() - startedAt < 1000);
  assert.equal(started.status, "running");
  parent.kill("SIGKILL");
  await once(parent, "exit");
  const done = await s.until(started.task_id);
  assert.equal(done.status, "success");
  assert.equal(done.summary, "ok");
  assert.equal(done.session_id, "thread-fake-1");
  assert.ok(done.heartbeat_at);
  assert.equal(s.turn(done.task_id).author, "host");
  assert.equal(s.turn(done.task_id).prompt, "parent lifetime");
  assert.deepEqual(s.events(done.task_id).map((event) => event.type), ["turn_started", "message", "turn_ended"]);
  assert.match(fs.readFileSync(path.join(s.dir(done.task_id), "raw/1.stdout.log"), "utf8"), /thread.started/);
  assert.equal(fs.statSync(path.join(s.dir(done.task_id), "raw/1.stdout.log")).mode & 0o777, 0o600);
  assert.equal((await s.run("status", done.task_id)).status, "success");
});

test("start 拒绝递归、缺少参数与未安装，stdout 错误也为单个 JSON", async (t) => {
  const s = sandbox(t);
  for (const args of [["start"], ["start", "--target", "codex", "--prompt", "hi", "--idle-timeout", "0"], ["status", "../x"]]) {
    await assert.rejects(exec(process.execPath, [cli, ...args], { cwd: s.cwd, env: s.env }), (error: unknown) => {
      const e = error as { stdout: string; code: number };
      assert.ok(e.code !== 0); assert.equal(JSON.parse(e.stdout).status, "failed"); return true;
    });
  }
  s.env.BATON_DELEGATION = "1";
  await assert.rejects(s.run("start", "--target", "codex", "--prompt", "hi"), /Command failed/);
  s.env.BATON_DELEGATION = "0";
  s.env.PATH = s.cwd;
  await assert.rejects(exec(process.execPath, [cli, "start", "--target", "codex", "--prompt", "hi"], { cwd: s.cwd, env: s.env }), (error: unknown) => {
    assert.equal(JSON.parse((error as { stdout: string }).stdout).status, "not_installed"); return true;
  });
  assert.ok(!fs.existsSync(path.join(s.home, "tasks")));
});

test("鉴权、额度、terminal error 与正常退出沿用旧判定", async (t) => {
  const s = sandbox(t);
  for (const [text, exit, status] of [["codex login", "1", "not_authenticated"], ["turn.failed: usage limit", "1", "quota_exceeded"], ["turn.failed: disk full", "1", "failed"], ["plain text", "0", "success"]]) {
    fs.writeFileSync(s.fixture, text);
    s.env.FAKE_EXIT = exit;
    const started = await s.run("start", "--target", "codex", "--prompt", "hi");
    assert.equal((await s.until(started.task_id)).status, status);
  }
});

test("idle 与 max_duration 杀整个进程组；cancel 同样终止孙进程", async (t) => {
  const s = sandbox(t);
  for (const mode of ["idle", "max_duration", "cancel"] as const) {
    const pidFile = path.join(s.home, `${mode}.pid`);
    s.env.FAKE_CHILD_PID_FILE = pidFile;
    s.env.FAKE_HANG = "1";
    const args = mode === "idle" ? ["--idle-timeout", "0.4"] : mode === "max_duration" ? ["--max-duration", "0.4"] : [];
    const started = await s.run("start", "--target", "codex", "--prompt", "hi", ...args);
    await s.until(started.task_id, (m) => !!m.child_pid && fs.existsSync(pidFile));
    const grandchild = Number(fs.readFileSync(pidFile, "utf8"));
    assert.ok(grandchild > 1);
    const active = await s.run("status", started.task_id);
    assert.equal(active.liveness, "active");
    assert.equal(typeof active.quiet_for_s, "number");
    if (mode === "cancel") assert.equal((await s.run("cancel", started.task_id)).status, "cancelled");
    const done = await s.until(started.task_id);
    assert.equal(done.status, mode === "cancel" ? "cancelled" : "timed_out");
    if (mode !== "cancel") assert.match(done.summary!, new RegExp(mode));
    await assertProcessGone(grandchild);
    assert.equal(s.events(started.task_id).at(-1)?.type, "turn_ended");
  }
});

async function assertProcessGone(pid: number) {
  for (let i = 0; i < 100; i++) {
    try { process.kill(pid, 0); } catch { return; }
    await sleep(20);
  }
  assert.fail(`进程 ${pid} 未退出`);
}

test("supervisor 被杀后 status 报 orphaned、杀残留进程并且只补写一次终态", async (t) => {
  const s = sandbox(t);
  s.env.FAKE_HANG = "1";
  s.env.FAKE_CHILD_PID_FILE = path.join(s.home, "orphan.pid");
  const started = await s.run("start", "--target", "codex", "--prompt", "hi");
  const running = await s.until(started.task_id, (m) => !!m.child_pid && fs.existsSync(s.env.FAKE_CHILD_PID_FILE!));
  process.kill(running.supervisor_pid!, "SIGKILL");
  await sleep(50);
  const recovered = await s.run("status", started.task_id);
  assert.equal(recovered.liveness, "orphaned");
  assert.equal(recovered.status, "failed");
  assert.equal(recovered.summary, "supervisor 意外退出");
  await assertProcessGone(Number(fs.readFileSync(s.env.FAKE_CHILD_PID_FILE!, "utf8")));
  const count = s.events(started.task_id).length;
  assert.equal((await s.run("status", started.task_id)).status, "failed");
  assert.equal(s.events(started.task_id).length, count);
  assert.equal(s.turn(started.task_id).status, "failed");
});

test("无 max_duration 时持续输出不会被杀，空闲计时按字节而非整行", async (t) => {
  const s = sandbox(t);
  s.env.FAKE_TICKS = "12";
  s.env.FAKE_TICK_SLEEP = "0.08";
  const started = await s.run("start", "--target", "codex", "--prompt", "hi", "--idle-timeout", "0.3");
  const done = await s.until(started.task_id);
  assert.equal(done.status, "success");
  assert.equal(done.max_duration_s, null);
});

test("心跳每 10s 更新；读 status 不改写存活任务", async (t) => {
  const s = sandbox(t);
  s.env.FAKE_HANG = "1";
  const started = await s.run("start", "--target", "codex", "--prompt", "hi");
  const running = await s.until(started.task_id, (m) => !!m.child_pid && !!m.session_id);
  await sleep(50);
  const before = fs.readFileSync(path.join(s.dir(started.task_id), "meta.json"), "utf8");
  await s.run("status", started.task_id);
  assert.equal(fs.readFileSync(path.join(s.dir(started.task_id), "meta.json"), "utf8"), before);
  const beat = await s.until(started.task_id, (m) => m.heartbeat_at !== running.heartbeat_at, 12_000);
  assert.ok(Date.parse(beat.heartbeat_at!) - Date.parse(running.heartbeat_at!) >= 9_500);
  await s.run("cancel", started.task_id);
});

test("存活但久无事件为 quiet，心跳过期视为孤儿", async (t) => {
  const s = sandbox(t);
  const { status } = await import("../src/tasks.ts");
  const oldHome = process.env.BATON_HOME;
  process.env.BATON_HOME = s.home;
  t.after(() => { if (oldHome === undefined) delete process.env.BATON_HOME; else process.env.BATON_HOME = oldHome; });
  const { writeMeta } = await import("../src/store.ts");
  const now = new Date().toISOString();
  const id = "11111111-1111-4111-8111-111111111111";
  const meta: TaskMeta = { task_id: id, target: "codex", cwd: s.cwd, created_at: now, updated_at: now, status: "running", turn: 1, session_id: null, idle_timeout_s: 600, max_duration_s: null, supervisor_pid: process.pid, child_pid: null, heartbeat_at: now, last_event_at: new Date(Date.now() - 61_000).toISOString() };
  writeMeta(meta);
  assert.equal(status(id).liveness, "quiet");
  assert.ok(status(id).quiet_for_s! >= 60);
  // 使用已退出的 pid，避免终止测试进程。
  meta.supervisor_pid = 2147483000;
  meta.heartbeat_at = new Date(Date.now() - 31_000).toISOString();
  writeMeta(meta);
  assert.equal(status(id).liveness, "orphaned");
});

test("needs_input → reply 续同一 session，记录 human/host 作者与原始输入，超时重新计时", async (t) => {
  const s = sandbox(t);
  const decision = { type: "item.completed", item: { type: "agent_message", text: "BATON_DECISION\nquestion: 选哪个？\noptions: A | B\nBATON_END" } };
  fs.writeFileSync(s.fixture, `${JSON.stringify({ type: "thread.started", thread_id: "thread-fake-1" })}\n${JSON.stringify(decision)}\n`);
  const first = await s.run("start", "--target", "codex", "--prompt", "ask", "--max-duration", "0.6");
  const pending = await s.until(first.task_id);
  assert.equal(pending.status, "needs_input");
  assert.deepEqual(pending.decision, { question: "选哪个？", options: ["A", "B"] });
  await sleep(650);
  fs.writeFileSync(s.fixture, `${JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "BATON_RESULT\nsummary: continued\nBATON_END" } })}\n`);
  s.env.FAKE_ARGS_FILE = path.join(s.home, "argv.txt");
  s.env.FAKE_INPUT_FILE = path.join(s.home, "stdin.txt");
  s.env.FAKE_SLEEP = "0.2";
  const next = await s.run("reply", first.task_id, "--prompt", "A", "--as", "human");
  assert.equal(next.status, "running");
  assert.equal(next.turn, 2);
  const done = await s.until(first.task_id);
  assert.equal(done.status, "success");
  assert.equal(done.decision, undefined);
  assert.equal(s.turn(first.task_id, 2).author, "human");
  assert.equal(s.turn(first.task_id, 2).prompt, "A");
  assert.equal(s.turn(first.task_id, 1).status, "needs_input");
  const args = fs.readFileSync(s.env.FAKE_ARGS_FILE, "utf8").trim().split("\n");
  assert.deepEqual(args.slice(0, 3), ["exec", "resume", "--json"]);
  assert.equal(args.at(-2), "thread-fake-1");
  assert.match(fs.readFileSync(s.env.FAKE_INPUT_FILE, "utf8"), /^A\n\n完成前/);
  assert.ok(s.events(first.task_id).every((event) => event.turn >= 1));
  const again = await s.run("reply", first.task_id, "--prompt", "follow up");
  await s.until(first.task_id);
  assert.equal(again.turn, 3);
  assert.equal(s.turn(first.task_id, 3).author, "host");
});

test("running reply 返回 busy；失败、无 session 和无效作者不可续接", async (t) => {
  const s = sandbox(t);
  s.env.FAKE_HANG = "1";
  const first = await s.run("start", "--target", "codex", "--prompt", "busy");
  await assert.rejects(s.run("reply", first.task_id, "--prompt", "intrude"), (error: unknown) => {
    assert.equal(JSON.parse((error as { stdout: string }).stdout).status, "busy"); return true;
  });
  await s.run("cancel", first.task_id);
  await assert.rejects(s.run("reply", first.task_id, "--prompt", "late"));
  s.env.FAKE_HANG = "0";
  fs.writeFileSync(s.fixture, "no session\n");
  const noSession = await s.run("start", "--target", "codex", "--prompt", "hi");
  await s.until(noSession.task_id);
  await assert.rejects(s.run("reply", noSession.task_id, "--prompt", "hi"));
  await assert.rejects(s.run("reply", noSession.task_id, "--prompt", "hi", "--as", "nobody"));
});

test("并发 reply 只有一个新轮次；重复 _supervise 不拉起第二个 worker", async (t) => {
  const s = sandbox(t);
  const first = await s.run("start", "--target", "codex", "--prompt", "hello");
  await s.until(first.task_id);
  s.env.FAKE_SLEEP = "0.4";
  const replies = await Promise.allSettled([s.run("reply", first.task_id, "--prompt", "one"), s.run("reply", first.task_id, "--prompt", "two")]);
  assert.equal(replies.filter((r) => r.status === "fulfilled").length, 1);
  const running = s.meta(first.task_id);
  await exec(process.execPath, [cli, "_supervise", first.task_id], { cwd: s.cwd, env: s.env });
  assert.equal(s.meta(first.task_id).supervisor_pid, running.supervisor_pid);
  const done = await s.until(first.task_id);
  assert.equal(done.turn, 2);
  assert.equal(s.events(first.task_id).filter((event) => event.type === "turn_started" && event.turn === 2).length, 1);
});

test("start 返回后立即 cancel，即使 gitSnapshot 尚未结束也记 cancelled", async (t) => {
  const s = sandbox(t);
  s.env.FAKE_GIT_SLEEP = "0.4";
  s.env.FAKE_HANG = "1";
  const first = await s.run("start", "--target", "codex", "--prompt", "cancel early");
  assert.equal((await s.run("cancel", first.task_id)).status, "cancelled");
  assert.equal(s.turn(first.task_id).status, "cancelled");
});

test("事件和摘要不记录凭据，原始日志完整保留并受权限保护", async (t) => {
  const s = sandbox(t);
  s.env.FAKE_API_TOKEN = "canary-private-value";
  fs.writeFileSync(s.fixture, `${JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: 'BATON_RESULT\nsummary: {"token":"unknown-canary"} Bearer bearer-canary canary-private-value\nBATON_END' } })}\n`);
  const first = await s.run("start", "--target", "codex", "--prompt", "token=prompt-canary");
  const done = await s.until(first.task_id);
  const events = fs.readFileSync(path.join(s.dir(first.task_id), "events.jsonl"), "utf8");
  for (const secret of ["unknown-canary", "bearer-canary", "canary-private-value", "prompt-canary"]) {
    assert.ok(!events.includes(secret), `events 包含测试凭据 ${secret}`);
    assert.ok(!done.summary?.includes(secret));
  }
  const raw = fs.readFileSync(path.join(s.dir(first.task_id), "raw/1.stdout.log"), "utf8");
  assert.match(raw, /canary-private-value/);
  assert.equal(s.turn(first.task_id).prompt, "token=prompt-canary");
});

test("last-message 文件未生成时仍能使用流消息判定成功", async (t) => {
  const s = sandbox(t);
  s.env.FAKE_REMOVE_LAST = "1";
  const first = await s.run("start", "--target", "codex", "--prompt", "fallback");
  assert.equal((await s.until(first.task_id)).status, "success");
});

test("supervisor 无法启动时，meta 与本轮记录均为 failed", async (t) => {
  const s = sandbox(t);
  const source = path.join(s.home, "src");
  fs.cpSync(path.resolve(import.meta.dirname, "../src"), source, { recursive: true });
  fs.unlinkSync(path.join(source, "cli.ts"));
  const driver = `import { start } from ${JSON.stringify(path.join(source, "tasks.ts"))}; console.log(JSON.stringify(await start({ target: "codex", prompt: "unavailable", cwd: process.cwd() })));`;
  const result = await exec(process.execPath, ["--input-type=module", "-e", driver], { cwd: s.cwd, env: s.env });
  const meta = JSON.parse(result.stdout) as TaskMeta;
  assert.equal(meta.status, "failed");
  assert.equal(s.turn(meta.task_id).status, "failed");
  assert.equal(s.events(meta.task_id).at(-1)?.type, "turn_ended");
});

test("supervisor pid 存在但心跳过期时，先杀写者再恢复孤儿终态", async (t) => {
  const s = sandbox(t);
  s.env.FAKE_HANG = "1";
  const first = await s.run("start", "--target", "codex", "--prompt", "stalled");
  const meta = await s.until(first.task_id, (m) => !!m.session_id);
  process.kill(meta.supervisor_pid!, "SIGSTOP");
  fs.writeFileSync(path.join(s.dir(first.task_id), "meta.json"), JSON.stringify({ ...meta, heartbeat_at: new Date(Date.now() - 31_000).toISOString() }));
  const recovered = await s.run("status", first.task_id);
  assert.equal(recovered.liveness, "orphaned");
  assert.equal(recovered.status, "failed");
  await assertProcessGone(meta.supervisor_pid!);
  await assertProcessGone(meta.child_pid!);
});
