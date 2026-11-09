import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { adapters, getAdapter } from "./adapters/index.mjs";
import { gitChanges, gitSnapshot } from "./git.mjs";

const OUTPUT_TAIL = 8192;
const CAPTURE_MAX = 2_000_000;
const CAPTURE_HEAD = 65_536;
const CAPTURE_TAIL = 262_144;

export const OUTPUT_CONTRACT = [
  "完成前用下面两种结尾之一。标记必须各占一行。",
  "需要用户做选择时停下来，不要猜，也不要继续后面的步骤：",
  "APA_DECISION",
  "question: <一个问题>",
  "options: <选项A> | <选项B>",
  "APA_END",
  "",
  "做完时：",
  "APA_RESULT",
  "summary: <做了什么>",
  "APA_END",
  "",
  "不要再调用其他 Agent。",
].join("\n");

export function buildPrompt(prompt, files) {
  const focus = files?.length
    ? `Focus on these files:\n${files.map((file) => `- ${file}`).join("\n")}\n\n`
    : "";
  return `${focus}${String(prompt).trim()}\n\n${OUTPUT_CONTRACT}`;
}

export function interpret(text) {
  if (!text) return null;
  const re = /APA_(DECISION|RESULT)\r?\n([\s\S]*?)\r?\nAPA_END/g;
  let last = null;
  for (const match of text.matchAll(re)) last = match;
  if (!last) return null;
  const body = last[2];
  if (last[1] === "DECISION") {
    const question = body.match(/^question:\s*(.*)$/m)?.[1]?.trim() || "";
    const options = (body.match(/^options:\s*(.*)$/m)?.[1] || "")
      .split("|")
      .map((item) => item.trim())
      .filter(Boolean);
    return { kind: "decision", question, options };
  }
  const summary = body.replace(/^summary:\s*/m, "").trim();
  return { kind: "result", summary };
}

function clampTimeout(seconds) {
  if (seconds == null || seconds === "") return 300_000;
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return 300_000;
  return Math.min(value, 1800) * 1000;
}

function tailText(text) {
  const value = String(text || "");
  return value.length <= OUTPUT_TAIL ? value : value.slice(-OUTPUT_TAIL);
}

class Capture {
  constructor() {
    this.head = "";
    this.tail = "";
    this.overflow = false;
  }

  push(chunk) {
    const text = typeof chunk === "string" ? chunk : chunk.toString();
    if (!this.overflow) {
      this.tail += text;
      if (this.tail.length > CAPTURE_MAX) {
        this.head = this.tail.slice(0, CAPTURE_HEAD);
        this.tail = this.tail.slice(-CAPTURE_TAIL);
        this.overflow = true;
      }
      return;
    }
    this.tail = (this.tail + text).slice(-CAPTURE_TAIL);
  }

  text() {
    if (!this.overflow) return this.tail;
    // shortcut: 超过 2MB 只留头尾，升级时改成落盘。
    return `${this.head}\n...[truncated]...\n${this.tail}`;
  }
}

function lockFile(cwd) {
  const hash = crypto.createHash("sha256").update(path.resolve(cwd)).digest("hex").slice(0, 16);
  return path.join(os.tmpdir(), `apa-${hash}.lock`);
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function acquire(cwd) {
  const file = lockFile(cwd);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = fs.openSync(file, "wx");
      fs.writeFileSync(fd, String(process.pid));
      return { file, fd };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let owner = Number.NaN;
      try {
        owner = Number(fs.readFileSync(file, "utf8"));
      } catch {
        owner = Number.NaN;
      }
      if (pidAlive(owner)) return null;
      try {
        fs.unlinkSync(file);
      } catch {
        return null;
      }
    }
  }
  return null;
}

function release(lock) {
  if (!lock) return;
  try {
    fs.closeSync(lock.fd);
  } catch {
    // Already closed.
  }
  try {
    fs.unlinkSync(lock.file);
  } catch {
    // Another run may already have removed a stale lock.
  }
}

function killChild(child) {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    // The child may already have exited, or it is not a process-group leader.
  }
  try {
    child.kill("SIGKILL");
  } catch {
    // Already gone.
  }
}

const tasks = new Map();

function taskKey(cwd) {
  return `cwd:${path.resolve(cwd)}`;
}

function statusFile(cwd) {
  return lockFile(cwd).replace(/\.lock$/, ".status.json");
}

function publish(record, view) {
  record.view = view;
  try {
    fs.writeFileSync(statusFile(record.cwd), JSON.stringify(view));
  } catch {
    // The temp directory can reject the write. The in-memory view still works.
  }
}

function track(record) {
  tasks.set(record.taskId, record);
  tasks.set(taskKey(record.cwd), record);
}

function readStatusFile(cwd) {
  try {
    return { fileOnly: true, view: JSON.parse(fs.readFileSync(statusFile(cwd), "utf8")) };
  } catch {
    return null;
  }
}

function lookup(taskId, cwd) {
  if (taskId) return tasks.get(taskId) || null;
  return tasks.get(taskKey(cwd)) || readStatusFile(cwd);
}

function startProcess(spec, timeoutMs, spawnImpl) {
  const stdout = new Capture();
  const stderr = new Capture();
  let settled = false;
  let timedOut = false;
  let exitCode = null;
  let grace = null;
  let timer = null;
  let resolveDone;
  const done = new Promise((resolve) => {
    resolveDone = resolve;
  });
  const finish = () => {
    if (settled) return;
    settled = true;
    if (timer) clearTimeout(timer);
    if (grace) clearTimeout(grace);
    resolveDone({
      exitCode,
      stdout: stdout.text(),
      stderr: stderr.text(),
      timedOut,
    });
  };
  let child = null;
  try {
    child = spawnImpl(spec.command, spec.args, {
      cwd: spec.cwd,
      env: spec.env,
      detached: true,
      stdio: [spec.stdin == null ? "ignore" : "pipe", "pipe", "pipe"],
    });
  } catch (error) {
    stderr.push(error.message);
    exitCode = 1;
    finish();
  }
  const disarm = () => {
    if (timer) clearTimeout(timer);
    if (grace) clearTimeout(grace);
  };
  if (child) {
    timer = setTimeout(() => {
      timedOut = true;
      killChild(child);
      grace = setTimeout(finish, 1000);
    }, timeoutMs);
    child.stdout?.on("data", (chunk) => stdout.push(chunk));
    child.stderr?.on("data", (chunk) => stderr.push(chunk));
    child.on("error", (error) => {
      stderr.push(error.message);
      exitCode = 1;
      finish();
    });
    child.on("close", (code) => {
      exitCode = code ?? 1;
      finish();
    });
    if (spec.stdin != null) {
      child.stdin?.write(spec.stdin);
      child.stdin?.end();
    }
  }
  return {
    done,
    isSettled: () => settled,
    output: () => ({ stdout: stdout.text(), stderr: stderr.text() }),
    kill: () => {
      disarm();
      killChild(child);
    },
  };
}

function blank(target, started, sessionId) {
  return {
    target_agent: target,
    duration_ms: Date.now() - started,
    exit_code: null,
    output: "",
    session_id: sessionId || null,
  };
}

function describe(record, ran) {
  const pack = (fields) => ({
    task_id: record.taskId,
    ...blank(record.target, record.started, record.sessionId),
    ...fields,
  });
  let lastMessage = "";
  if (record.lastMessagePath) {
    try {
      lastMessage = fs.readFileSync(record.lastMessagePath, "utf8");
    } catch {
      lastMessage = "";
    }
  }
  const message = record.adapter.messageFrom(ran.stdout, lastMessage);
  const sessionId = record.adapter.sessionIdFrom(ran.stdout) || record.sessionId || null;
  const marker = interpret(message || ran.stdout);
  const output = tailText(message || ran.stdout);
  const git_changes = gitChanges(record.cwd, record.before, gitSnapshot(record.cwd));
  const base = { exit_code: ran.exitCode, output, session_id: sessionId, git_changes };
  if (record.cancelled) return pack({ ...base, status: "cancelled", summary: "已取消。" });
  if (ran.timedOut) return pack({ ...base, status: "timed_out", summary: output });
  if (ran.exitCode !== 0 && record.adapter.isAuthFailure(`${ran.stderr}\n${ran.stdout}`)) {
    return pack({ ...base, status: "not_authenticated", summary: tailText(ran.stderr || output) });
  }
  if (marker?.kind === "decision") {
    return pack({
      ...base,
      status: "needs_decision",
      question: marker.question,
      options: marker.options,
      summary: marker.question,
    });
  }
  if (ran.exitCode === 0 && !record.adapter.failed(ran.stdout)) {
    const summary = marker?.kind === "result" ? marker.summary : message || output;
    return pack({ ...base, status: "success", summary: tailText(summary) });
  }
  return pack({ ...base, status: "failed", summary: tailText(ran.stderr || message || output) });
}

function runningView(record) {
  const snap = record.proc.output();
  const message = record.adapter.messageFrom(snap.stdout, "");
  const sessionId = record.adapter.sessionIdFrom(snap.stdout) || null;
  return {
    task_id: record.taskId,
    ...blank(record.target, record.started, sessionId),
    status: "running",
    output: tailText(message || snap.stdout),
    summary: "子 Agent 已启动。",
    git_changes: gitChanges(record.cwd, record.before, gitSnapshot(record.cwd)),
  };
}

function complete(record, view) {
  if (record.final) return record.final;
  record.final = view;
  publish(record, view);
  if (record.lastMessagePath) {
    try {
      fs.unlinkSync(record.lastMessagePath);
    } catch {
      // The CLI may not have created the file.
    }
  }
  release(record.lock);
  record.lock = null;
  return view;
}

function versionOf(bin, env) {
  const result = spawnSync(bin, ["--version"], { encoding: "utf8", timeout: 5000, env });
  return `${result.stdout || ""}\n${result.stderr || ""}`.trim().split("\n").filter(Boolean)[0] || null;
}

export function listAgents(env = process.env) {
  return Object.values(adapters).map((adapter) => {
    const bin = adapter.resolve(env);
    if (!bin) return { id: adapter.id, installed: false, bin: null, version: null };
    return { id: adapter.id, installed: true, bin, version: versionOf(bin, env) };
  });
}

export async function delegate(input, deps = {}) {
  const started = Date.now();
  const env = input.env ?? process.env;
  const cwd = path.resolve(input.cwd || env.APA_CWD || process.cwd());
  const target = input.target;
  const pack = (fields) => ({
    target_agent: target,
    duration_ms: Date.now() - started,
    exit_code: null,
    output: "",
    session_id: input.sessionId || null,
    ...fields,
  });

  if (env.APA_DELEGATION === "1") {
    return pack({ status: "failed", summary: "APA_DELEGATION=1，拒绝再次派工。" });
  }
  const adapter = getAdapter(target);
  if (!adapter) return pack({ status: "failed", summary: `未知目标：${target}` });
  const bin = adapter.resolve(env);
  if (!bin) return pack({ status: "not_installed", summary: `${target} 不在 PATH 里。` });
  if (!input.prompt || !String(input.prompt).trim()) {
    return pack({ status: "failed", summary: "缺少 prompt。" });
  }

  const lock = acquire(cwd);
  if (!lock) return pack({ status: "busy", summary: "这个工作区已有派工在跑。" });

  let spec;
  try {
    spec = adapter.build({
      bin,
      cwd,
      prompt: buildPrompt(input.prompt, input.files),
      sessionId: input.sessionId || null,
    });
  } catch (error) {
    release(lock);
    return pack({ status: "failed", summary: error.message });
  }

  const proc = startProcess(
    { ...spec, cwd, env: { ...env, APA_DELEGATION: "1" } },
    clampTimeout(input.timeoutSeconds),
    deps.spawnImpl ?? spawn,
  );
  const record = {
    taskId: crypto.randomUUID(),
    target,
    cwd,
    started,
    adapter,
    sessionId: input.sessionId || null,
    before: gitSnapshot(cwd),
    lastMessagePath: spec.lastMessagePath || null,
    lock,
    proc,
    final: null,
    cancelled: false,
  };
  track(record);
  await Promise.resolve();
  if (proc.isSettled()) return complete(record, describe(record, await proc.done));

  proc.done.then((ran) => complete(record, describe(record, ran)));
  const view = runningView(record);
  publish(record, view);
  return view;
}

function locate(input = {}) {
  const env = input.env ?? process.env;
  const cwd = path.resolve(input.cwd || env.APA_CWD || process.cwd());
  return { cwd, record: lookup(input.taskId, cwd) };
}

export function taskStatus(input = {}) {
  const { record } = locate(input);
  if (!record) {
    return {
      status: "failed",
      task_id: input.taskId || null,
      summary: "没有这一单派工。",
    };
  }
  if (record.fileOnly) return record.view;
  if (record.final) return record.final;
  const view = runningView(record);
  publish(record, view);
  return view;
}

export function taskCancel(input = {}) {
  const { record } = locate(input);
  if (!record || record.fileOnly) {
    return {
      status: "failed",
      task_id: input.taskId || null,
      summary: "没有可取消的派工。",
    };
  }
  if (record.final) return record.final;
  record.cancelled = true;
  record.proc.kill();
  if (record.final) return record.final;
  return complete(record, describe(record, {
    exitCode: null,
    stdout: record.proc.output().stdout,
    stderr: record.proc.output().stderr,
    timedOut: false,
  }));
}
