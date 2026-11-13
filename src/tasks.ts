import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { adapters, getAdapter } from "./adapters/index.ts";
import { readMeta, writeMeta, writeTurn, readTurn, appendEvent, taskDir, lockTask, listTasks } from "./store.ts";
import { setTimeout as sleep } from "node:timers/promises";
import { redact } from "./redact.ts";
import { isAlive, killGroup } from "./process.ts";
import type { Author, Effort, GitChanges, TaskMeta } from "./types.ts";

export type StartInput = { target: string; prompt: string; cwd?: string; files?: string[]; model?: string; reasoningEffort?: Effort; idleTimeout?: number; maxDuration?: number };
export type StartResult = TaskMeta | { status: "failed" | "not_installed"; summary: string };

function positive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} 必须为正数。`);
  return value;
}

async function launch(id: string): Promise<void> {
  const child = spawn(process.execPath, [path.join(import.meta.dirname, "cli.ts"), "_supervise", id], { detached: true, stdio: "ignore", env: process.env });
  await once(child, "spawn");
  child.unref();
  const deadline = Date.now() + 750;
  while (Date.now() < deadline) {
    if (readMeta(id)?.supervisor_pid === child.pid) return;
    await sleep(10);
  }
  child.kill("SIGKILL");
  killGroup(readMeta(id)?.child_pid ?? null);
  throw new Error("supervisor 未就绪。");
}

export async function start(input: StartInput): Promise<StartResult> {
  if (process.env.BATON_DELEGATION === "1") return { status: "failed", summary: "BATON_DELEGATION=1，拒绝再次派工。" };
  if (!input.prompt?.trim()) throw new Error("缺少 prompt。");
  const adapter = getAdapter(input.target);
  if (!adapter) throw new Error(`未知目标：${input.target}`);
  const idle = positive(input.idleTimeout ?? 600, "idle_timeout");
  const max = input.maxDuration == null ? null : positive(input.maxDuration, "max_duration");
  if (input.reasoningEffort && !["low", "medium", "high", "ultra"].includes(input.reasoningEffort)) throw new Error("未知 effort。");
  if (input.model !== undefined && (typeof input.model !== "string" || !input.model.trim())) throw new Error("model 必须为非空字符串。");
  const cwd = path.resolve(input.cwd || process.env.BATON_CWD || process.cwd());
  if (!fs.statSync(cwd).isDirectory()) throw new Error("cwd 必须是目录。");
  if (!adapter.resolve(process.env)) return { status: "not_installed", summary: `${input.target} 不在 PATH 里。` };
  const now = new Date().toISOString();
  const meta: TaskMeta = {
    task_id: randomUUID(), target: adapter.id, cwd, created_at: now, updated_at: now,
    status: "running", turn: 1, session_id: null, model: input.model, reasoning_effort: input.reasoningEffort,
    idle_timeout_s: idle, max_duration_s: max, supervisor_pid: null, child_pid: null,
    heartbeat_at: null, last_event_at: null,
  };
  writeMeta(meta);
  writeTurn(meta.task_id, { turn: 1, author: "host", prompt: input.prompt, files: input.files, status: "running" });
  return launchTurn(meta);
}

async function launchTurn(meta: TaskMeta): Promise<TaskMeta> {
  try { await launch(meta.task_id); } catch (error) {
    const failed: TaskMeta = { ...readMeta(meta.task_id) ?? meta, status: "failed", updated_at: new Date().toISOString(), summary: redact(`supervisor 启动失败：${(error as Error).message}`) };
    writeTurn(meta.task_id, { ...readTurn(meta.task_id, meta.turn), status: "failed", summary: failed.summary });
    appendEvent(meta.task_id, { ts: failed.updated_at, turn: meta.turn, type: "turn_ended", status: "failed", exit_code: null });
    writeMeta(failed);
    return failed;
  }
  return meta;
}

export type TaskView = TaskMeta & { liveness?: "active" | "quiet" | "orphaned"; quiet_for_s?: number; git_changes?: GitChanges };

// 终态视图带上本轮 git_changes，宿主不用再去读 turns/<n>.json。
function finished(meta: TaskMeta): TaskView {
  try { return { ...meta, git_changes: readTurn(meta.task_id, meta.turn).git_changes }; } catch { return meta; }
}

function orphaned(meta: TaskMeta): boolean {
  if (!meta.supervisor_pid) return Date.now() - Date.parse(meta.updated_at) > 30_000;
  return !isAlive(meta.supervisor_pid) || !meta.heartbeat_at || Date.now() - Date.parse(meta.heartbeat_at) > 30_000;
}

export function status(id: string): TaskView {
  let meta = readMeta(id);
  if (!meta) throw new Error("没有这一单派工。");
  if (meta.status !== "running") return finished(meta);
  const quiet = Math.max(0, (Date.now() - Date.parse(meta.last_event_at || meta.updated_at)) / 1000);
  if (!orphaned(meta)) return { ...meta, liveness: quiet <= 60 ? "active" : "quiet", quiet_for_s: quiet };
  const release = lockTask(id);
  if (!release) return { ...meta, liveness: "orphaned", quiet_for_s: quiet };
  try {
    meta = readMeta(id)!;
    if (meta.status !== "running" || !orphaned(meta)) return meta;
    // 心跳可能只是写慢；再次检查 pid。心跳过期且仍存活时先停止写者，再接管。
    if (isAlive(meta.supervisor_pid)) {
      try { process.kill(meta.supervisor_pid!, "SIGKILL"); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
    }
    killGroup(meta.child_pid);
    meta.status = "failed";
    meta.summary = "supervisor 意外退出";
    meta.updated_at = new Date().toISOString();
    try { const turn = readTurn(id, meta.turn); writeTurn(id, { ...turn, status: "failed", summary: meta.summary }); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    appendEvent(id, { ts: meta.updated_at, turn: meta.turn, type: "turn_ended", status: "failed", exit_code: null });
    writeMeta(meta);
    return { ...meta, liveness: "orphaned", quiet_for_s: quiet };
  } finally { release(); }
}

export async function cancel(id: string): Promise<TaskView> {
  let meta = status(id);
  if (meta.status !== "running") return meta;
  const end = Date.now() + 2000;
  let signalled: number | null = null;
  while (Date.now() < end) {
    meta = status(id);
    if (meta.status !== "running") return meta;
    if (meta.supervisor_pid !== signalled && isAlive(meta.supervisor_pid)) {
      try { process.kill(meta.supervisor_pid!, "SIGTERM"); signalled = meta.supervisor_pid; } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
    }
    await sleep(20);
  }
  throw new Error("取消尚未确认，请重试 status。");
}

export async function wait(ids: string[], seconds = 50): Promise<TaskView | { status: "running"; tasks: TaskView[] }> {
  if (!ids.length) throw new Error("缺少 task_ids。");
  ids.forEach(taskDir);
  if (!Number.isFinite(seconds) || seconds < 0) throw new Error("for 必须为非负秒数。");
  const deadline = Date.now() + seconds * 1000;
  for (;;) {
    const views = ids.map(status);
    const done = views.find((view) => view.status !== "running");
    if (done) return done;
    if (Date.now() >= deadline) return views.length === 1 ? views[0] : { status: "running", tasks: views };
    await sleep(Math.min(100, Math.max(0, deadline - Date.now())));
  }
}

export async function reply(id: string, prompt: string, author: Author = "host"): Promise<TaskMeta | { task_id: string; status: "busy"; summary: string }> {
  taskDir(id);
  if (process.env.BATON_DELEGATION === "1") throw new Error("BATON_DELEGATION=1，拒绝再次派工。");
  if (!prompt.trim()) throw new Error("缺少 prompt。");
  if (author !== "host" && author !== "human") throw new Error("as 必须为 host 或 human。");
  const current = status(id);
  const busy = { task_id: id, status: "busy" as const, summary: "这一单正在运行。" };
  if (current.status === "running") return busy;
  const release = lockTask(id);
  if (!release) return busy;
  let next: TaskMeta;
  try {
    const meta = readMeta(id)!;
    if (meta.status === "running") return busy;
    if (!["success", "needs_input"].includes(meta.status)) throw new Error(`不能继续 ${meta.status} 的任务。`);
    if (!meta.session_id) throw new Error("没有 session_id，无法续会话。");
    if (!getAdapter(meta.target)?.resolve(process.env)) throw new Error(`${meta.target} 不在 PATH 里。`);
    next = { ...meta, status: "running", turn: meta.turn + 1, updated_at: new Date().toISOString(), supervisor_pid: null, child_pid: null, heartbeat_at: null, last_event_at: null };
    delete next.decision;
    delete next.summary;
    writeTurn(id, { turn: next.turn, author, prompt, status: "running" });
    writeMeta(next);
  } finally { release(); }
  return launchTurn(next);
}

export function ls(all = false, cwd = process.cwd()): TaskView[] {
  return listTasks().filter((meta) => all || meta.cwd === path.resolve(cwd)).map((meta) => status(meta.task_id))
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
}

export function prune(older: number): string[] {
  const cutoff = Date.now() - older * 86_400_000;
  if (!Number.isFinite(older) || older < 0 || !Number.isFinite(cutoff)) throw new Error("older 必须为非负天数。");
  const deleted: string[] = [];
  for (const candidate of listTasks()) {
    if (candidate.status === "running" || Date.parse(candidate.updated_at) >= cutoff) continue;
    let release: (() => void) | null;
    try { release = lockTask(candidate.task_id); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    if (!release) continue;
    try {
      const meta = readMeta(candidate.task_id);
      if (!meta || meta.status === "running" || !(Date.parse(meta.updated_at) < cutoff)) continue;
      fs.rmSync(taskDir(meta.task_id), { recursive: true });
      deleted.push(meta.task_id);
    } finally { release(); }
  }
  return deleted;
}

export function agents(env: NodeJS.ProcessEnv = process.env): { id: string; installed: boolean; bin: string | null; version: string | null }[] {
  return Object.values(adapters).map((adapter) => {
    const bin = adapter.resolve(env);
    if (!bin) return { id: adapter.id, installed: false, bin: null, version: null };
    const ran = spawnSync(bin, ["--version"], { encoding: "utf8", timeout: 5000, env });
    const version = `${ran.stdout || ""}\n${ran.stderr || ""}`.trim().split("\n").filter(Boolean)[0] || null;
    return { id: adapter.id, installed: true, bin, version };
  });
}
