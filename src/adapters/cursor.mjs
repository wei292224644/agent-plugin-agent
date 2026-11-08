import { authHit, jsonFailed, messageFromJson, sessionFromJson, which } from "./common.mjs";

const AUTH = ["not authenticated", "please log in", "agent login"];

export const cursor = {
  id: "cursor",
  resolve(env) {
    // cursor-agent 名字不会撞上 IDE 的 `cursor`，也比 PATH 里别的 `agent` 先命中。
    return which(["cursor-agent", "agent"], env);
  },
  build({ bin, cwd, prompt, sessionId }) {
    const args = ["--print", "--force", "--trust", "--output-format", "json", "--workspace", cwd];
    if (sessionId) args.push("--resume", sessionId);
    args.push(prompt);
    return { command: bin, args, stdin: null };
  },
  sessionIdFrom(stdout) {
    return sessionFromJson(stdout, ["session_id"]);
  },
  messageFrom(stdout) {
    return messageFromJson(stdout, ["result"]);
  },
  failed: jsonFailed,
  isAuthFailure(text) {
    return authHit(text, AUTH);
  },
};
