import os from "node:os";
import path from "node:path";
import { authHit, which } from "./common.mjs";

const AUTH = ["not logged in", "please log in", "authentication required", "codex login"];

export const codex = {
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
  sessionIdFrom(stdout) {
    for (const line of String(stdout || "").split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        if (obj.type === "thread.started" && obj.thread_id) return String(obj.thread_id);
      } catch {
        // Ignore non-JSON log lines.
      }
    }
    return null;
  },
  messageFrom(stdout, lastMessage) {
    if (lastMessage && lastMessage.trim()) return lastMessage.trim();
    let text = "";
    for (const line of String(stdout || "").split(/\r?\n/)) {
      try {
        const obj = JSON.parse(line);
        if (obj.type === "item.completed" && obj.item?.type === "agent_message" && obj.item.text) {
          text = obj.item.text;
        }
      } catch {
        // Ignore non-JSON log lines.
      }
    }
    return text;
  },
  failed() {
    return false;
  },
  isAuthFailure(text) {
    return authHit(text, AUTH);
  },
};
