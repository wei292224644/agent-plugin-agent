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
  "BATON_DECISION",
  "question: <一个问题>",
  "options: <选项A> | <选项B>",
  "BATON_END",
  "",
  "做完时：",
  "BATON_RESULT",
  "summary: <做了什么>",
  "BATON_END",
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
  const re = /(?:APA|BATON)_(DECISION|RESULT)\r?\n([\s\S]*?)\r?\n(?:APA|BATON)_END/g;
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

const DEFAULT_TIMEOUT_SECONDS = 300;
const MAX_TIMEOUT_SECONDS = 1800;

export function resolveTimeout(seconds) {
  const requested = seconds == null || seconds === "" ? null : Number(seconds);
  const valid = Number.isFinite(requested) && requested > 0;
  const effectiveSeconds = valid
    ? Math.min(requested, MAX_TIMEOUT_SECONDS)
    : DEFAULT_TIMEOUT_SECONDS;
  return {
    ms: effectiveSeconds * 1000,
    effectiveSeconds,
    clamped: valid && requested > MAX_TIMEOUT_SECONDS,
  };
}

function tailText(text) {
  const value = String(text || "");
  return value.length <= OUTPUT_TAIL ? value : value.slice(-OUTPUT_TAIL);
}

const QUOTA_PHRASES = ["usage limit", "quota exceeded", "rate limit"];

function withoutHtml(text) {
  return String(text || "")
    .replace(/<!doctype[\s\S]*?(?:<\/html>|$)/gi, "")
    .replace(/<html[\s\S]*?(?:<\/html>|$)/gi, "")
    .trim();
}

function terminalReason(text) {
  let found = "";
  for (const line of String(text || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!/turn\.failed/i.test(trimmed)) continue;
    try {
      const obj = JSON.parse(trimmed);
      const msg = obj?.error?.message || obj?.message;
      if (typeof msg === "string" && msg.trim()) {
        found = msg.trim();
        continue;
      }
    } catch {
      // Plain log line, not a JSON event.
    }
    found = trimmed;
  }
  return found;
}

function isQuotaFailure(text) {
  const hay = String(text || "").toLowerCase();
  return QUOTA_PHRASES.some((phrase) => hay.includes(phrase));
}

function quotaSentence(text) {
  const lines = String(text || "").split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (isQuotaFailure(lines[i])) return lines[i].trim();
  }
  return "";
}

function failureSummary(stdout, stderr) {
  const combined = `${stdout || ""}\n${stderr || ""}`;
  const reason = terminalReason(combined);
  if (reason) return tailText(reason);
  return tailText(withoutHtml(stderr) || withoutHtml(stdout));
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

function workspaceHash(cwd) {
  return crypto.createHash("sha256").update(path.resolve(cwd)).digest("hex").slice(0, 16);
}

function statusFile(cwd, taskId) {
  if (!/^[0-9a-f-]{36}$/i.test(taskId)) return null;
  return path.join(os.tmpdir(), `baton-${workspaceHash(cwd)}.${taskId}.status.json`);
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

function publish(record, view) {
  record.view = view;
  try {
    fs.writeFileSync(statusFile(record.cwd, record.taskId), JSON.stringify(view));
  } catch {
    // The temp directory can reject the write. The in-memory view still works.
  }
}

function track(record) {
  tasks.set(record.taskId, record);
}

function readStatusFile(cwd, taskId) {
  const file = statusFile(cwd, taskId);
  if (!file) return null;
  try {
    return { fileOnly: true, view: JSON.parse(fs.readFileSync(file, "utf8")) };
  } catch {
    return null;
  }
}

function memoryRecords(cwd) {
  const resolved = path.resolve(cwd);
  return [...tasks.values()].filter((record) => record.cwd === resolved);
}

function latestByStarted(records) {
  return records.reduce((best, record) => (record.started >= best.started ? record : best));
}

function statusSnapshots(cwd) {
  const prefix = `baton-${workspaceHash(cwd)}.`;
  const suffix = ".status.json";
  let names;
  try {
    names = fs.readdirSync(os.tmpdir());
  } catch {
    return [];
  }
  const snapshots = [];
  for (const name of names) {
    if (!name.startsWith(prefix) || !name.endsWith(suffix)) continue;
    const taskId = name.slice(prefix.length, -suffix.length);
    if (!taskId) continue;
    try {
      const file = path.join(os.tmpdir(), name);
      snapshots.push({
        taskId,
        mtime: fs.statSync(file).mtimeMs,
        view: JSON.parse(fs.readFileSync(file, "utf8")),
      });
    } catch {
      // A partial or unreadable snapshot is skipped.
    }
  }
  return snapshots;
}

function nextForRunning(taskId) {
  return `开一个宿主后台子 Agent，调用 task_wait(task_id="${taskId}")，把返回原样交回；主会话不要等待，也不要轮询 task_status。`;
}

function nextForDecision() {
  return "把 question 和 options 交给用户；拿到选择后用同一个 session_id 再调 delegate_task。";
}

function nextForTimeout(sessionId) {
  const resume = sessionId
    ? `用同一个 session_id="${sessionId}" 再调 delegate_task 续做`
    : "再调 delegate_task 续做，并保存返回的 session_id 以便后续续做";
  return `超时已杀进程。${resume}；显式传更大的 timeout_seconds（默认 ${DEFAULT_TIMEOUT_SECONDS}，上限 ${MAX_TIMEOUT_SECONDS}）。不要在当前会话里把活做掉。`;
}

function summaryForTimeout(output, effectiveSeconds) {
  const prefix = `超时（${effectiveSeconds}s）。\n`;
  const body = String(output || "").trim() || "无子 Agent 输出。";
  const budget = Math.max(0, OUTPUT_TAIL - prefix.length);
  const clipped = body.length <= budget ? body : body.slice(-budget);
  return `${prefix}${clipped}`;
}

function runningList(items) {
  return {
    status: "running",
    summary: "这个工作区有多单在跑，请指定 task_id。",
    tasks: items,
  };
}

function snapshotTask(snapshot) {
  return {
    task_id: snapshot.view.task_id || snapshot.taskId,
    target_agent: snapshot.view.target_agent,
    duration_ms: snapshot.view.duration_ms,
    effective_timeout_seconds: snapshot.view.effective_timeout_seconds,
  };
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
  const base = {
    exit_code: ran.exitCode,
    output,
    session_id: sessionId,
    git_changes,
    effective_timeout_seconds: record.effectiveTimeoutSeconds,
  };
  if (record.cancelled) return pack({ ...base, status: "cancelled", summary: "已取消。" });
  if (ran.timedOut) {
    return pack({
      ...base,
      status: "timed_out",
      summary: summaryForTimeout(output, record.effectiveTimeoutSeconds),
      next: nextForTimeout(sessionId),
    });
  }
  const raw = `${ran.stderr}\n${ran.stdout}`;
  if (ran.exitCode !== 0 && record.adapter.isAuthFailure(raw)) {
    return pack({ ...base, status: "not_authenticated", summary: tailText(ran.stderr || output) });
  }
  if (ran.exitCode !== 0 && isQuotaFailure(raw)) {
    const reason = terminalReason(raw) || quotaSentence(raw);
    return pack({ ...base, status: "quota_exceeded", summary: tailText(reason) });
  }
  if (marker?.kind === "decision") {
    return pack({
      ...base,
      status: "needs_decision",
      question: marker.question,
      options: marker.options,
      summary: marker.question,
      next: nextForDecision(),
    });
  }
  if (ran.exitCode === 0 && !record.adapter.failed(ran.stdout)) {
    const summary = marker?.kind === "result" ? marker.summary : message || output;
    return pack({ ...base, status: "success", summary: tailText(summary) });
  }
  return pack({ ...base, status: "failed", summary: failureSummary(ran.stdout, ran.stderr) });
}

function runningView(record) {
  const snap = record.proc.output();
  const raw = snap.stdout || "";
  let lastMessage = "";
  if (record.lastMessagePath) {
    try {
      lastMessage = fs.readFileSync(record.lastMessagePath, "utf8");
    } catch {
      lastMessage = "";
    }
  }
  const fromAdapter = record.adapter.messageFrom(raw, lastMessage);
  const output = tailText(fromAdapter || raw);
  if (raw !== record.lastStdout || output !== record.lastOutputText) {
    record.lastStdout = raw;
    record.lastOutputText = output;
    if (output) record.lastOutputAt = Date.now();
  }
  const sessionId = record.adapter.sessionIdFrom(raw) || null;
  return {
    task_id: record.taskId,
    ...blank(record.target, record.started, sessionId),
    status: "running",
    output,
    last_output_at: record.lastOutputAt || null,
    summary: output ? "子 Agent 输出中。" : "子 Agent 已启动。",
    git_changes: gitChanges(record.cwd, record.before, gitSnapshot(record.cwd)),
    effective_timeout_seconds: record.effectiveTimeoutSeconds,
  };
}

function complete(record, view) {
  if (record.final) return record.final;
  record.final = view;
  publish(record, view);
  record.settle?.(view);
  if (record.lastMessagePath) {
    try {
      fs.unlinkSync(record.lastMessagePath);
    } catch {
      // The CLI may not have created the file.
    }
  }
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
  const cwd = path.resolve(input.cwd || env.BATON_CWD || process.cwd());
  const target = input.target;
  const pack = (fields) => ({
    target_agent: target,
    duration_ms: Date.now() - started,
    exit_code: null,
    output: "",
    session_id: input.sessionId || null,
    ...fields,
  });

  if (env.BATON_DELEGATION === "1") {
    return pack({ status: "failed", summary: "BATON_DELEGATION=1，拒绝再次派工。" });
  }
  const adapter = getAdapter(target);
  if (!adapter) return pack({ status: "failed", summary: `未知目标：${target}` });
  const bin = adapter.resolve(env);
  if (!bin) return pack({ status: "not_installed", summary: `${target} 不在 PATH 里。` });
  if (!input.prompt || !String(input.prompt).trim()) {
    return pack({ status: "failed", summary: "缺少 prompt。" });
  }

  let spec;
  try {
    spec = adapter.build({
      bin,
      cwd,
      prompt: buildPrompt(input.prompt, input.files),
      sessionId: input.sessionId || null,
    });
  } catch (error) {
    return pack({ status: "failed", summary: error.message });
  }

  const timeout = resolveTimeout(input.timeoutSeconds);
  const proc = startProcess(
    { ...spec, cwd, env: { ...env, BATON_DELEGATION: "1" } },
    timeout.ms,
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
    proc,
    final: null,
    cancelled: false,
    effectiveTimeoutSeconds: timeout.effectiveSeconds,
  };
  record.settled = new Promise((resolve) => {
    record.settle = resolve;
  });
  track(record);
  await Promise.resolve();
  if (proc.isSettled()) return complete(record, describe(record, await proc.done));

  proc.done.then((ran) => complete(record, describe(record, ran)));
  const view = runningView(record);
  publish(record, view);
  return { ...view, next: nextForRunning(record.taskId) };
}

function resolveCwd(input = {}) {
  const env = input.env ?? process.env;
  return path.resolve(input.cwd || env.BATON_CWD || process.cwd());
}

function viewOf(record) {
  if (record.final) return record.final;
  const view = runningView(record);
  publish(record, view);
  return view;
}

const WAIT_PROGRESS_MS = 15_000;

function progressLine(view) {
  const line = String(view?.output || view?.summary || "").trim().split("\n").filter(Boolean).pop() || "";
  return line.slice(0, 200);
}

export function progressNotification(extra, step, view) {
  const token = extra?._meta?.progressToken;
  if (token == null) return null;
  return {
    method: "notifications/progress",
    params: {
      progressToken: token,
      progress: step,
      message: progressLine(view),
    },
  };
}

export async function taskWait(input = {}) {
  const cwd = resolveCwd(input);
  const taskId = input.taskId;
  if (!taskId) return { status: "failed", task_id: null, summary: "缺少 task_id。" };

  const record = tasks.get(taskId);
  if (!record) {
    const stored = readStatusFile(cwd, taskId);
    if (stored && stored.view?.status !== "running") return stored.view;
    return {
      status: "failed",
      task_id: taskId,
      summary: stored ? "这一单不在当前进程里，没法守着。" : "没有这一单派工。",
    };
  }
  if (record.final) return record.final;

  const onProgress = input.onProgress;
  let stopped = false;
  const beat = () => {
    if (stopped || record.final) return;
    const view = viewOf(record);
    if (stopped || view.status !== "running") return;
    try {
      Promise.resolve(onProgress?.(view)).catch(() => {});
    } catch {
      // Progress is a hint. A throw must not end the wait.
    }
  };
  const timer = onProgress ? setInterval(beat, input.intervalMs ?? WAIT_PROGRESS_MS) : null;
  if (onProgress) beat();
  try {
    return await record.settled;
  } finally {
    stopped = true;
    if (timer) clearInterval(timer);
  }
}

export async function taskWaitAny(input = {}) {
  const cwd = resolveCwd(input);
  const taskIds = Array.isArray(input.taskIds)
    ? input.taskIds.filter(Boolean)
    : input.taskId
      ? [input.taskId]
      : [];
  if (!taskIds.length) {
    return { status: "failed", task_id: null, summary: "缺少 task_ids。" };
  }

  const liveRecords = [];
  for (const id of taskIds) {
    const record = tasks.get(id);
    if (record) {
      if (record.final) return record.final;
      liveRecords.push(record);
    } else {
      const stored = readStatusFile(cwd, id);
      if (stored && stored.view?.status !== "running") return stored.view;
      return {
        status: "failed",
        task_id: id,
        summary: stored ? "这一单不在当前进程里，没法守着。" : "没有这一单派工。",
      };
    }
  }

  const onProgress = input.onProgress;
  let stopped = false;
  const beat = () => {
    if (stopped) return;
    const running = liveRecords.filter((r) => !r.final);
    if (stopped || !running.length) return;
    const views = running.map((r) => viewOf(r));
    const lines = views.map((v) => progressLine(v)).filter(Boolean);
    const summary = `正在等待 ${running.length} 单派工（${running.map((r) => r.taskId).join(", ")}）。`;
    const composite = {
      status: "running",
      summary,
      output: lines.join(" | ") || summary,
    };
    try {
      Promise.resolve(onProgress?.(composite)).catch(() => {});
    } catch {
      // Progress is a hint. A throw must not end the wait.
    }
  };
  const timer = onProgress ? setInterval(beat, input.intervalMs ?? WAIT_PROGRESS_MS) : null;
  if (onProgress) beat();
  try {
    return await Promise.race(liveRecords.map((r) => r.settled));
  } finally {
    stopped = true;
    if (timer) clearInterval(timer);
  }
}

export function taskStatus(input = {}) {
  const cwd = resolveCwd(input);
  if (input.taskId) {
    const record = tasks.get(input.taskId);
    if (record) return viewOf(record);
    const stored = readStatusFile(cwd, input.taskId);
    if (stored) return stored.view;
    return {
      status: "failed",
      task_id: input.taskId,
      summary: "没有这一单派工。",
    };
  }

  const records = memoryRecords(cwd);
  const live = records.filter((record) => !record.final);
  if (live.length === 1) return viewOf(live[0]);
  if (live.length > 1) {
    return runningList(live.map((record) => ({
      task_id: record.taskId,
      target_agent: record.target,
      duration_ms: Date.now() - record.started,
      effective_timeout_seconds: record.effectiveTimeoutSeconds,
    })));
  }
  if (records.length) return latestByStarted(records).final;

  const snapshots = statusSnapshots(cwd);
  const running = snapshots.filter((snapshot) => snapshot.view?.status === "running");
  if (running.length === 1) return running[0].view;
  if (running.length > 1) return runningList(running.map(snapshotTask));
  if (snapshots.length) {
    return snapshots.reduce((best, snapshot) => (snapshot.mtime >= best.mtime ? snapshot : best)).view;
  }
  return {
    status: "failed",
    task_id: null,
    summary: "没有这一单派工。",
  };
}

function cancelRecord(record, taskId) {
  if (!record || record.fileOnly) {
    return {
      status: "failed",
      task_id: taskId || null,
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

export function taskCancel(input = {}) {
  const cwd = resolveCwd(input);
  if (input.taskId) {
    return cancelRecord(tasks.get(input.taskId), input.taskId);
  }

  const records = memoryRecords(cwd);
  const live = records.filter((record) => !record.final);
  if (live.length > 1) {
    return {
      status: "failed",
      summary: "有多单在跑，请指定 task_id。",
      task_ids: live.map((record) => record.taskId),
    };
  }
  if (live.length === 1) return cancelRecord(live[0], live[0].taskId);
  if (records.length) return latestByStarted(records).final;

  const snapshots = statusSnapshots(cwd);
  const running = snapshots.filter((snapshot) => snapshot.view?.status === "running");
  if (running.length > 1) {
    return {
      status: "failed",
      summary: "有多单在跑，请指定 task_id。",
      task_ids: running.map((snapshot) => snapshot.view.task_id || snapshot.taskId),
    };
  }
  if (running.length === 1) {
    return {
      status: "failed",
      task_id: running[0].view.task_id || running[0].taskId,
      summary: "没有可取消的派工。",
    };
  }
  if (snapshots.length) {
    return snapshots.reduce((best, snapshot) => (snapshot.mtime >= best.mtime ? snapshot : best)).view;
  }
  return {
    status: "failed",
    task_id: null,
    summary: "没有可取消的派工。",
  };
}
