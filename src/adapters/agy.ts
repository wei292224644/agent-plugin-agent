import type { Adapter, BatonEvent, EventData } from "../types.ts";
import { redact } from "../redact.ts";
import { authHit, which } from "./common.ts";

const AUTH = ["not logged in", "please log in", "authentication required"];

function event(data: EventData): BatonEvent[] {
  return [{ ts: new Date().toISOString(), turn: 0, ...data }];
}

function parse(line: string): any {
  try { return JSON.parse(line); } catch { return null; }
}

export const agy: Adapter = {
  id: "agy",
  resolve(env) {
    return which(["agy"], env);
  },
  build({ bin, prompt, sessionId, model, reasoningEffort }) {
    const args = ["--print", prompt, "--mode", "accept-edits", "--output-format", "stream-json"];
    if (reasoningEffort) args.push("--effort", reasoningEffort === "ultra" ? "max" : reasoningEffort);
    if (model) args.push("--model", model);
    if (sessionId) args.push("--conversation", sessionId);
    return { command: bin, args, stdin: null };
  },
  sessionIdFrom(line) {
    const obj = parse(line);
    return obj?.event === "init" && typeof obj.conversation_id === "string" ? obj.conversation_id : null;
  },
  parseLine(line) {
    const obj = parse(line);
    if (!obj || typeof obj !== "object" || typeof obj.event !== "string") return null;
    if (obj.event === "init") return [];
    if (obj.event === "step_update") {
      const step = obj.step_update ?? {};
      // agent_response 的 text_delta 是逐字增量；完整回复在 result.response 里出一次，
      // 否则标记解析只会看到最后一个增量。
      if (step.step_type !== "tool") return [];
      const name = String(step.tool_name ?? step.tool_info?.name ?? "tool");
      const detail = redact(JSON.stringify(step.tool_info?.parameters ?? {})).slice(0, 200);
      if (step.state === "ACTIVE") return event({ type: "tool_call", name, detail });
      return event({ type: "tool_result", name, ok: step.state === "DONE", detail });
    }
    if (obj.event === "result") {
      const result = obj.result ?? {};
      if (result.status !== "SUCCESS") return event({ type: "error", text: redact(String(result.response || result.status || "agy 返回错误")) });
      return typeof result.response === "string" && result.response ? event({ type: "message", text: result.response }) : [];
    }
    return null;
  },
  isAuthFailure(text) {
    return authHit(text, AUTH);
  },
};
