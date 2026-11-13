import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import { batonHome, taskDir, writeMeta, readMeta, appendEvent, writeTurn, listTasks } from "../src/store.ts";
import type { TaskMeta } from "../src/types.ts";

test("任务存储校验 UUID、隔离 BATON_HOME 并保护权限", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "baton-store-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const previous = process.env.BATON_HOME;
  process.env.BATON_HOME = home;
  t.after(() => { if (previous === undefined) delete process.env.BATON_HOME; else process.env.BATON_HOME = previous; });
  assert.equal(batonHome(), home);
  assert.throws(() => taskDir("../x"), /UUID/);
  assert.throws(() => readMeta("a".repeat(36)), /UUID/);
  assert.throws(() => writeTurn(randomUUID(), { turn: -1, author: "host", prompt: "", status: "running" }), /轮/);
  const id = randomUUID();
  const now = new Date().toISOString();
  const meta: TaskMeta = {
    task_id: id, target: "codex", cwd: home, created_at: now, updated_at: now,
    status: "running", turn: 1, session_id: null, idle_timeout_s: 600,
    max_duration_s: null, supervisor_pid: null, child_pid: null, heartbeat_at: null, last_event_at: null,
  };
  assert.equal(readMeta(id), null);
  writeMeta(meta);
  appendEvent(id, { ts: now, turn: 1, type: "message", text: "hi" });
  writeTurn(id, { turn: 1, author: "host", prompt: "hi", status: "running" });
  assert.deepEqual(readMeta(id), meta);
  assert.deepEqual(listTasks(), [meta]);
  for (const dir of [home, path.join(home, "tasks"), taskDir(id), path.join(taskDir(id), "turns"), path.join(taskDir(id), "raw")]) {
    assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
  }
  for (const file of ["meta.json", "events.jsonl", "turns/1.json"]) {
    assert.equal(fs.statSync(path.join(taskDir(id), file)).mode & 0o777, 0o600);
  }
  assert.equal(JSON.parse(fs.readFileSync(path.join(taskDir(id), "events.jsonl"), "utf8")).text, "hi");
  process.env.BATON_HOME = "";
  assert.equal(batonHome(), path.join(os.homedir(), ".baton"));
});

test("原子写 meta：另一线程持续读取时永远获得完整 JSON", async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "baton-atomic-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const previous = process.env.BATON_HOME;
  process.env.BATON_HOME = home;
  t.after(() => { if (previous === undefined) delete process.env.BATON_HOME; else process.env.BATON_HOME = previous; });
  const id = randomUUID();
  const meta = { task_id: id, summary: "x".repeat(100_000) } as TaskMeta;
  writeMeta(meta);
  const worker = new Worker(`
    const { parentPort, workerData } = require("node:worker_threads");
    const fs = require("node:fs");
    parentPort.postMessage("ready");
    for (let i = 0; i < 1000; i++) JSON.parse(fs.readFileSync(workerData, "utf8"));
  `, { eval: true, workerData: path.join(taskDir(id), "meta.json") });
  const done = new Promise<void>((resolve, reject) => { worker.on("exit", (code) => code ? reject(new Error(`worker ${code}`)) : resolve()); worker.on("error", reject); });
  await new Promise((resolve) => worker.once("message", resolve));
  for (let i = 0; i < 100; i++) writeMeta({ ...meta, summary: String(i).repeat(100_000) });
  await done;
  assert.ok(readMeta(id));
});

test("脱敏在摘要和预览截断之前执行，长凭据不会以片段泄漏", async () => {
  const { redact } = await import("../src/redact.ts");
  const secret = "canary".repeat(60);
  const previous = process.env.BATON_TEST_TOKEN;
  process.env.BATON_TEST_TOKEN = secret;
  try {
    assert.equal(redact(`prefix ${secret} end`).slice(0, 200), "prefix [REDACTED] end");
    const { codex } = await import("../src/adapters/codex.ts");
    const event = codex.parseLine(JSON.stringify({ type: "item.started", item: { type: "command_execution", command: secret } }))?.[0];
    assert.ok(event?.type === "tool_call");
    assert.equal(event.detail, "[REDACTED]");
  } finally { if (previous === undefined) delete process.env.BATON_TEST_TOKEN; else process.env.BATON_TEST_TOKEN = previous; }
});
