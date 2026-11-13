import { execFileSync } from "node:child_process";
import type { Adapter, BatonEvent, Effort, EventData } from "../types.ts";
import { redact } from "../redact.ts";
import { authHit, which } from "./common.ts";

const AUTH = ["not authenticated", "please log in", "agent login"];

function effortModel(bin: string, model: string | undefined, effort: Effort): string {
  if (!model || model === "auto") throw new Error("Cursor 设置 effort 时必须用 --model 指定支持档位的模型，Auto 不支持独立档位。");
  // 2026.11.11 的帮助含括号语法，但本机账号拒绝部分覆盖；只选 models 实际列出的 ID。
  const models = execFileSync(bin, ["models"], { encoding: "utf8", timeout: 15_000, stdio: ["ignore", "pipe", "pipe"] })
    .split(/\r?\n/).map((line) => line.match(/^([^\s]+)\s+-\s+/)?.[1]).filter(Boolean);
  const fast = model.endsWith("-fast") ? "-fast" : "";
  const base = (fast ? model.slice(0, -fast.length) : model).replace(/-(?:none|minimal|low|medium|high|xhigh|extra-high|max)$/, "");
  const levels = effort === "ultra" ? ["max", "xhigh", "extra-high"] : [effort];
  const selected = levels.map((level) => `${base}-${level}${fast}`).find((id) => models.includes(id));
  if (!selected) throw new Error(`Cursor 模型 ${model} 不支持 effort=${effort}；请用 cursor-agent models 查看可用模型 ID。`);
  return selected;
}

function event(data: EventData): BatonEvent[] {
  return [{ ts: new Date().toISOString(), turn: 0, ...data }];
}

function parse(line: string): any {
  try { return JSON.parse(line); } catch { return null; }
}

export const cursor: Adapter = {
  id: "cursor",
  resolve(env) {
    // cursor-agent 名字不会撞上 IDE 的 `cursor`，也比 PATH 里别的 `agent` 先命中。
    return which(["cursor-agent", "agent"], env);
  },
  build({ bin, cwd, prompt, sessionId, model, reasoningEffort }) {
    const args = ["--print", "--force", "--trust", "--output-format", "stream-json", "--workspace", cwd];
    const selected = reasoningEffort ? effortModel(bin, model, reasoningEffort) : model;
    if (selected) args.push("--model", selected);
    if (sessionId) args.push("--resume", sessionId);
    args.push(prompt);
    return { command: bin, args, stdin: null };
  },
  sessionIdFrom(line) {
    const obj = parse(line);
    return obj?.type === "system" && obj.subtype === "init" && typeof obj.session_id === "string" ? obj.session_id : null;
  },
  parseLine(line) {
    const obj = parse(line);
    if (!obj || typeof obj !== "object" || typeof obj.type !== "string") return null;
    // init 由 sessionIdFrom 处理；user 是 prompt 回显；thinking 是逐字增量，只会刷屏。
    if (["system", "user", "thinking"].includes(obj.type)) return [];
    if (obj.type === "assistant") {
      const text = (obj.message?.content ?? [])
        .filter((part: any) => part?.type === "text" && typeof part.text === "string")
        .map((part: any) => part.text)
        .join("");
      return text ? event({ type: "message", text }) : [];
    }
    if (obj.type === "tool_call" && obj.tool_call && typeof obj.tool_call === "object") {
      const key = Object.keys(obj.tool_call)[0];
      if (!key) return null;
      const call = obj.tool_call[key] ?? {};
      const name = key.replace(/ToolCall$/, "");
      const args = call.args ?? {};
      const detail = redact(String(args.command ?? args.path ?? JSON.stringify(args))).slice(0, 200);
      if (obj.subtype === "started") return event({ type: "tool_call", name, detail });
      if (obj.subtype === "completed") return event({ type: "tool_result", name, ok: Boolean(call.result?.success), detail });
      return null;
    }
    if (obj.type === "result") {
      // 最终文本已经以 assistant 消息出过一次，这里只报错误。
      return obj.is_error ? event({ type: "error", text: redact(String(obj.result ?? "cursor 返回错误")) }) : [];
    }
    return null;
  },
  isAuthFailure(text) {
    return authHit(text, AUTH);
  },
};
