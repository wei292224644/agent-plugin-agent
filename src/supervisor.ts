import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { getAdapter } from "./adapters/index.ts";
import { buildPrompt, interpret } from "./contract.ts";
import { gitSnapshot, gitChanges } from "./git.ts";
import { appendEvent, readMeta, writeMeta, readTurn, writeTurn, taskDir, lockTask } from "./store.ts";
import { redact } from "./redact.ts";
import { killGroup } from "./process.ts";
import type { EventData, TaskStatus } from "./types.ts";
const QUOTA_PHRASES = ["usage limit", "quota exceeded", "rate limit"];

function withoutHtml(text: string) {
  return String(text || "")
    .replace(/<!doctype[\s\S]*?(?:<\/html>|$)/gi, "")
    .replace(/<html[\s\S]*?(?:<\/html>|$)/gi, "")
    .trim();
}

function terminalReason(text: string) {
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

function isQuotaFailure(text: string) {
  const hay = String(text || "").toLowerCase();
  return QUOTA_PHRASES.some((phrase) => hay.includes(phrase));
}

function quotaSentence(text: string) {
  const lines = String(text || "").split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (isQuotaFailure(lines[i])) return lines[i].trim();
  }
  return "";
}

function failureSummary(stdout: string, stderr: string) {
  const combined = `${stdout || ""}\n${stderr || ""}`;
  const reason = terminalReason(combined);
  if (reason) return reason.slice(-8192);
  return (withoutHtml(stderr) || withoutHtml(stdout)).slice(-8192);
}

export async function supervise(id: string): Promise<void> {
  const release = lockTask(id);
  if (!release) return;
  const meta = readMeta(id);
  if (!meta || meta.status !== "running" || meta.supervisor_pid !== null) { release(); return; }
  let childPid: number | null = null;
  let stopped: "idle" | "max_duration" | "cancelled" | null = null;
  const stop = (reason: typeof stopped) => {
    if (!stopped) stopped = reason;
    killGroup(childPid);
  };
  const cancel = () => stop("cancelled");
  process.on("SIGTERM", cancel);
  try {
    meta.supervisor_pid = process.pid;
    meta.heartbeat_at = new Date().toISOString();
    writeMeta(meta);
  } finally { release(); }
  const turn = readTurn(id, meta.turn);
  const adapter = getAdapter(meta.target);
  if (!adapter) throw new Error("未知目标。");
  const save = () => { meta.updated_at = new Date().toISOString(); writeMeta(meta); };
  const emit = (data: EventData) => {
    meta.last_event_at = new Date().toISOString();
    appendEvent(id, { ...data, ts: meta.last_event_at, turn: meta.turn });
    save();
  };
  emit({ type: "turn_started", author: turn.author, prompt_preview: redact(turn.prompt).slice(0, 200) });
  const heartbeat = setInterval(() => { meta.heartbeat_at = new Date().toISOString(); save(); }, 10_000);
  const before = gitSnapshot(meta.cwd);
  let stdout = "";
  let stderr = "";
  let message = "";
  let code: number | null = null;
  let spec;
  let lastMessageCreated = false;
  const startedAt = Date.now();
  let lastByteAt = startedAt;
  const timeout = setInterval(() => {
    if (Date.now() - lastByteAt >= meta.idle_timeout_s * 1000) stop("idle");
    else if (meta.max_duration_s !== null && Date.now() - startedAt >= meta.max_duration_s * 1000) stop("max_duration");
  }, 50);
  try {
    const bin = adapter.resolve(process.env);
    if (!bin) throw new Error(`${meta.target} 不在 PATH 里。`);
    spec = adapter.build({ bin, cwd: meta.cwd, prompt: buildPrompt(turn.prompt, turn.files), sessionId: meta.session_id, model: meta.model, reasoningEffort: meta.reasoning_effort ?? null });
    meta.warning = spec.warning;
    if (spec.lastMessagePath) {
      fs.writeFileSync(spec.lastMessagePath, "", { mode: 0o600, flag: "wx" });
      lastMessageCreated = true;
    }
    const child = spawn(spec.command, spec.args, { cwd: meta.cwd, env: { ...process.env, BATON_DELEGATION: "1" }, detached: true, stdio: [spec.stdin == null ? "ignore" : "pipe", "pipe", "pipe"] });
    childPid = child.pid ?? null;
    meta.child_pid = childPid;
    if (stopped) killGroup(childPid);
    save();
    for (const stream of ["stdout", "stderr"] as const) {
      const file = path.join(taskDir(id), "raw", `${meta.turn}.${stream}.log`);
      fs.writeFileSync(file, "", { mode: 0o600 });
      const output = child[stream]!;
      output.on("data", (chunk: Buffer) => {
        lastByteAt = Date.now();
        fs.appendFileSync(file, chunk);
        // shortcut: 判定只保留最近 2MB，完整输出始终在 raw；需要跨窗口标记时再扩展解析。
        if (stream === "stdout") stdout = (stdout + chunk.toString()).slice(-2_000_000);
        else stderr = (stderr + chunk.toString()).slice(-2_000_000);
      });
      const reader = createInterface({ input: output, crlfDelay: Infinity });
      reader.on("line", (line) => {
        const session = stream === "stdout" ? adapter.sessionIdFrom(line) : null;
        if (session) meta.session_id = session;
        const events = stream === "stdout" ? adapter.parseLine(line) : null;
        if (events === null) emit({ type: "raw", stream, line });
        else for (const event of events) {
          if (event.type === "message") message = event.text;
          emit(event);
        }
      });
    }
    const exited = new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    child.stdin?.on("error", () => {}); // 子 CLI 可能在读 stdin 之前退出，close 会提供最终结果。
    child.stdin?.end(spec.stdin ?? undefined);
    code = await exited;
    if (spec.lastMessagePath) {
      try {
        const last = fs.readFileSync(spec.lastMessagePath, "utf8").trim();
        if (last) message = last;
      } catch { /* 沿用旧逻辑：CLI 未写出文件时使用流消息。 */ }
    }
  } catch (error) {
    killGroup(childPid);
    stderr += (error as Error).message;
    emit({ type: "error", text: (error as Error).message });
    code = 1;
  } finally {
    clearInterval(heartbeat);
    clearInterval(timeout);
    if (lastMessageCreated && spec?.lastMessagePath) fs.rmSync(spec.lastMessagePath, { force: true });
  }
  const raw = `${stderr}\n${stdout}`;
  const marker = interpret(message || stdout);
  let final: TaskStatus = "failed";
  let summary = failureSummary(stdout, stderr);
  if (stopped) { final = stopped === "cancelled" ? "cancelled" : "timed_out"; summary = stopped === "cancelled" ? "已取消。" : `超时：${stopped}。`; }
  else if (code !== 0 && adapter.isAuthFailure(raw)) { final = "not_authenticated"; summary = stderr || message || stdout; }
  else if (code !== 0 && isQuotaFailure(raw)) { final = "quota_exceeded"; summary = terminalReason(raw) || quotaSentence(raw); }
  else if (marker?.kind === "decision") { final = "needs_input"; meta.decision = { question: marker.question, options: marker.options }; summary = marker.question; }
  else if (code === 0) { final = "success"; summary = marker?.kind === "result" ? marker.summary : message || stdout; }
  meta.summary = redact(summary).slice(-8192);
  meta.status = final;
  turn.status = final;
  turn.summary = meta.summary;
  turn.git_changes = gitChanges(meta.cwd, before, gitSnapshot(meta.cwd));
  writeTurn(id, turn);
  emit({ type: "turn_ended", status: final, exit_code: code });
  process.off("SIGTERM", cancel);
}
