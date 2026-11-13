import type { Adapter, BatonEvent, EventData } from "../types.ts";
import { redact } from "../redact.ts";
import { authHit, which } from "./common.ts";

const AUTH = ["not authenticated", "please log in", "agent login"];

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
  build({ bin, cwd, prompt, sessionId, reasoningEffort }) {
    const args = ["--print", "--force", "--trust", "--output-format", "stream-json", "--workspace", cwd];
    if (reasoningEffort) args.push("--model", `auto[effort=${reasoningEffort}]`);
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
