import { EventEmitter } from "node:events";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { delegate, interpret, taskCancel, taskStatus } from "../src/runner.mjs";
import { gitChanges, gitSnapshot } from "../src/git.mjs";

function binDir(name) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "baton-bin-"));
  const file = path.join(dir, name);
  writeFileSync(file, "#!/bin/sh\nexit 0\n");
  chmodSync(file, 0o755);
  return dir;
}

function child() {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = { write() {}, end() {} };
  proc.pid = 2147483000;
  proc.kill = () => {
    proc.killed = true;
    proc.emit("close", null);
  };
  return proc;
}

function spawnOk(payload, onSpawn) {
  return () => {
    const proc = child();
    queueMicrotask(() => {
      onSpawn?.(proc);
      proc.stdout.emit("data", typeof payload === "string" ? payload : JSON.stringify(payload));
      if (!proc.killed) proc.emit("close", 0);
    });
    return proc;
  };
}

test("interpret reads the last decision or result block", () => {
  const decision = interpret("noise\nAPA_DECISION\nquestion: 用 Redis 吗？\noptions: Redis | 内存\nAPA_END\n");
  assert.deepEqual(decision, { kind: "decision", question: "用 Redis 吗？", options: ["Redis", "内存"] });
  const result = interpret("APA_RESULT\nsummary: 已改 auth.ts\nAPA_END");
  assert.equal(result.summary, "已改 auth.ts");
  assert.equal(interpret("no marker"), null);
});

test("claude argv stays off the shell and resume adds --resume", async () => {
  const dir = binDir("claude");
  let args = [];
  const result = await delegate(
    {
      target: "claude",
      prompt: "记住 APA-1",
      files: ["src/a.ts"],
      sessionId: "sess-1",
      cwd: dir,
      env: { ...process.env, PATH: dir },
    },
    {
      spawnImpl: (command, argv) => {
        args = [command, argv];
        return spawnOk({
          session_id: "sess-1",
          result: "APA_RESULT\nsummary: 记住了\nAPA_END",
        })();
      },
    },
  );
  assert.equal(path.basename(args[0]), "claude");
  assert.ok(args[1].includes("--resume"));
  assert.ok(args[1].includes("sess-1"));
  assert.ok(args[1].includes("--permission-prompts"));
  assert.equal(args[1].at(-1).includes("APA_DECISION"), true);
  assert.equal(args[1].at(-1).includes("src/a.ts"), true);
  assert.equal(result.status, "success");
  assert.equal(result.summary, "记住了");
  assert.equal(result.session_id, "sess-1");
  rmSync(dir, { recursive: true, force: true });
});

test("codex resume argv drops sandbox flags and reads thread_id", async () => {
  const dir = binDir("codex");
  let argv = [];
  const result = await delegate(
    {
      target: "codex",
      prompt: "记住 APA-CODEX",
      sessionId: "thread-9",
      cwd: dir,
      env: { ...process.env, PATH: dir },
    },
    {
      spawnImpl: (command, args) => {
        argv = args;
        return spawnOk(
          `${JSON.stringify({ type: "thread.started", thread_id: "thread-9" })}\n${JSON.stringify({
            type: "item.completed",
            item: { type: "agent_message", text: "APA_RESULT\nsummary: ok\nAPA_END" },
          })}\n`,
        )();
      },
    },
  );
  assert.deepEqual(argv.slice(0, 3), ["exec", "resume", "--json"]);
  assert.equal(argv.includes("--sandbox"), false);
  assert.equal(argv.includes("--ephemeral"), false);
  assert.equal(argv.at(-2), "thread-9");
  assert.equal(result.session_id, "thread-9");
  assert.equal(result.status, "success");
  rmSync(dir, { recursive: true, force: true });
});

test("cursor prefers cursor-agent and passes --resume", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "baton-bin-"));
  for (const name of ["agent", "cursor-agent"]) {
    const file = path.join(dir, name);
    writeFileSync(file, "#!/bin/sh\nexit 0\n");
    chmodSync(file, 0o755);
  }
  let command = "";
  let argv = [];
  await delegate(
    {
      target: "cursor",
      prompt: "记住",
      sessionId: "chat-1",
      cwd: dir,
      env: { ...process.env, PATH: dir },
    },
    {
      spawnImpl: (bin, args) => {
        command = bin;
        argv = args;
        return spawnOk({ session_id: "chat-1", result: "APA_DECISION\nquestion: 选哪个？\noptions: A | B\nAPA_END" })();
      },
    },
  ).then((result) => {
    assert.equal(path.basename(command), "cursor-agent");
    assert.ok(argv.includes("--resume"));
    assert.ok(argv.includes("--workspace"));
    assert.equal(argv.includes("cursor"), false);
    assert.equal(result.status, "needs_decision");
    assert.deepEqual(result.options, ["A", "B"]);
  });
  rmSync(dir, { recursive: true, force: true });
});

test("missing binary, auth failure, timeout, busy, and re-entry", async () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "baton-work-"));
  const missing = await delegate({
    target: "codex",
    prompt: "hi",
    cwd,
    env: { ...process.env, PATH: cwd },
  });
  assert.equal(missing.status, "not_installed");

  const blocked = await delegate({
    target: "claude",
    prompt: "hi",
    cwd,
    env: { ...process.env, BATON_DELEGATION: "1" },
  });
  assert.equal(blocked.status, "failed");

  const dir = binDir("claude");
  const auth = await delegate(
    { target: "claude", prompt: "hi", cwd, env: { ...process.env, PATH: dir } },
    {
      spawnImpl: () => {
        const proc = child();
        queueMicrotask(() => {
          proc.stderr.emit("data", "Please run /login");
          proc.emit("close", 1);
        });
        return proc;
      },
    },
  );
  assert.equal(auth.status, "not_authenticated");

  const timed = await delegate(
    {
      target: "claude",
      prompt: "hi",
      timeoutSeconds: 0.05,
      cwd,
      env: { ...process.env, PATH: dir },
    },
    {
      spawnImpl: () => child(),
    },
  );
  assert.equal(timed.status, "running");
  let later = timed;
  for (let i = 0; i < 20 && later.status === "running"; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    later = taskStatus({ taskId: timed.task_id, cwd });
  }
  assert.equal(later.status, "timed_out");

  let release;
  const first = await delegate(
    { target: "claude", prompt: "hold", cwd, env: { ...process.env, PATH: dir } },
    {
      spawnImpl: () => {
        const proc = child();
        release = () => proc.emit("close", 0);
        return proc;
      },
    },
  );
  assert.equal(first.status, "running");
  const second = await delegate(
    { target: "claude", prompt: "other", cwd, env: { ...process.env, PATH: dir } },
    { spawnImpl: () => child() },
  );
  assert.equal(second.status, "busy");
  release();
  await new Promise((resolve) => setImmediate(resolve));
  const held = taskStatus({ taskId: first.task_id, cwd });
  assert.equal(held.status, "success");

  rmSync(dir, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

test("gemini and agy put the prompt and resume id in argv", async () => {
  for (const [target, binName, resumeFlag] of [
    ["gemini", "gemini", "--resume"],
    ["agy", "agy", "--conversation"],
  ]) {
    const dir = binDir(binName);
    let argv = [];
    await delegate(
      {
        target,
        prompt: "记住",
        sessionId: "id-1",
        cwd: dir,
        env: { ...process.env, PATH: dir },
      },
      {
        spawnImpl: (command, args) => {
          argv = args;
          const payload = target === "agy"
            ? { conversation_id: "id-1", status: "SUCCESS", response: "APA_RESULT\nsummary: ok\nAPA_END" }
            : { session_id: "id-1", response: "APA_RESULT\nsummary: ok\nAPA_END" };
          return spawnOk(payload)();
        },
      },
    );
    assert.equal(argv.includes(resumeFlag), true);
    assert.equal(argv.includes("id-1"), true);
    assert.equal(argv.some((arg) => String(arg).includes("APA_DECISION")), true);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a living child is reported only after it starts, then can be queried and cancelled", async () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "baton-live-"));
  const dir = binDir("claude");
  let proc;
  const started = await delegate(
    { target: "claude", prompt: "写模块", cwd, env: { ...process.env, PATH: dir } },
    {
      spawnImpl: () => {
        proc = child();
        return proc;
      },
    },
  );
  try {
    assert.equal(started.status, "running");
    assert.equal(started.summary, "子 Agent 已启动。");
    assert.equal(typeof started.task_id, "string");
    assert.equal(started.session_id, null);
    proc.stdout.emit("data", "正在写测试\n");
    const mid = taskStatus({ taskId: started.task_id, cwd });
    assert.equal(mid.status, "running");
    assert.match(mid.output, /正在写测试/);
    assert.ok(mid.duration_ms >= 0);
    const stopped = taskCancel({ taskId: started.task_id, cwd });
    assert.equal(stopped.status, "cancelled");
    const again = await delegate(
      { target: "claude", prompt: "下一单", cwd, env: { ...process.env, PATH: dir } },
      { spawnImpl: () => child() },
    );
    assert.equal(again.status, "running");
    taskCancel({ taskId: again.task_id, cwd });
  } finally {
    taskCancel({ cwd });
    rmSync(dir, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("gitChanges reports only paths whose porcelain line changed", () => {
  const cwd = mkdtempSync(path.join(import.meta.dirname, "tmp-"));
  const git = (args) => execFileSync("git", args, { cwd, encoding: "utf8" });
  git(["init"]);
  writeFileSync(path.join(cwd, "a.txt"), "one\n");
  git(["add", "a.txt"]);
  git(["-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-m", "init"]);
  const before = gitSnapshot(cwd);
  writeFileSync(path.join(cwd, "a.txt"), "one\ntwo\n");
  writeFileSync(path.join(cwd, "b.txt"), "new\n");
  const after = gitSnapshot(cwd);
  const changes = gitChanges(cwd, before, after);
  assert.equal(changes.files_changed, 2);
  assert.ok(changes.insertions >= 1);
  assert.match(changes.diff_stat, /a\.txt/);
  assert.match(changes.diff_stat, /b\.txt \| untracked/);
  rmSync(cwd, { recursive: true, force: true });
});
