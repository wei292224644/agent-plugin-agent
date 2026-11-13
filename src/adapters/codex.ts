import type { Adapter, BatonEvent, EventData } from "../types.ts";
import { redact } from "../redact.ts";
import os from "node:os";
import path from "node:path";
import { authHit, which } from "./common.ts";

const AUTH = ["not logged in", "please log in", "authentication required", "codex login"];

export const codex: Adapter = {
  id: "codex",
  resolve(env) {
    return which(["codex"], env);
  },
  build({ bin, cwd, prompt, sessionId, reasoningEffort }) {
    const lastMessagePath = path.join(os.tmpdir(), `baton-codex-${process.pid}-${Date.now()}.txt`);
    const effortArgs = reasoningEffort ? ["-c", `model_reasoning_effort="${reasoningEffort}"`] : [];
    // `exec resume` 不接受 --cd/--color。--approve-for-me 已使用 workspace-write，不要再加 --sandbox。
    if (sessionId) {
      return {
        command: bin,
        args: [
          "exec",
          "resume",
          "--json",
          "--skip-git-repo-check",
          "--output-last-message",
          lastMessagePath,
          ...effortArgs,
          sessionId,
          "-",
        ],
        stdin: prompt,
        lastMessagePath,
      };
    }
    return {
      command: bin,
      args: [
        "exec",
        "--json",
        "--color",
        "never",
        "--approve-for-me",
        "--skip-git-repo-check",
        "--cd",
        cwd,
        "--output-last-message",
        lastMessagePath,
        ...effortArgs,
        "-",
      ],
      stdin: prompt,
      lastMessagePath,
    };
  },
  sessionIdFrom(line) {
    try {
      const obj = JSON.parse(line);
      return obj?.type === "thread.started" && typeof obj.thread_id === "string" ? obj.thread_id : null;
    } catch { return null; }
  },
  parseLine(line) {
    let obj;
    try { obj = JSON.parse(line); } catch { return null; }
    if (!obj || typeof obj !== "object") return null;
    const event = (data: EventData): BatonEvent[] => [{ ts: new Date().toISOString(), turn: 0, ...data }];
    if (obj.type === "turn.failed" && typeof obj.error?.message === "string") return event({ type: "error", text: obj.error.message });
    // 生命周期事件：session id 由 sessionIdFrom 取，轮次起止由 supervisor 记录，这里不重复出事件。
    if (["thread.started", "turn.started", "turn.completed"].includes(obj.type)) return [];
    const item = obj.item;
    if (obj.type === "item.completed" && item?.type === "error" && typeof item.message === "string") {
      return event({ type: "error", text: redact(item.message) });
    }
    if (!item || !["item.started", "item.completed"].includes(obj.type)) return null;
    const completed = obj.type === "item.completed";
    if (item.type === "agent_message" && typeof item.text === "string") return completed ? event({ type: "message", text: item.text }) : [];
    if (item.type === "command_execution" && typeof item.command === "string") {
      return event(completed
        ? { type: "tool_result", name: "command_execution", ok: item.exit_code === 0, detail: redact(String(item.aggregated_output || item.command)).slice(0, 200) }
        : { type: "tool_call", name: "command_execution", detail: redact(item.command).slice(0, 200) });
    }
    if (item.type === "file_change" && Array.isArray(item.changes)) {
      const detail = redact(JSON.stringify(item.changes)).slice(0, 200);
      return event(completed
        ? { type: "tool_result", name: "file_change", ok: item.status === "completed", detail }
        : { type: "tool_call", name: "file_change", detail });
    }
    return null;
  },
  isAuthFailure(text) {
    return authHit(text, AUTH);
  },
};
