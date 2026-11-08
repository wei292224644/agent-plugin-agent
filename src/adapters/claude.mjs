import { authHit, jsonFailed, messageFromJson, sessionFromJson, which } from "./common.mjs";

const AUTH = ["not logged in", "please run /login", "invalid api key"];

export const claude = {
  id: "claude",
  resolve(env) {
    return which(["claude"], env);
  },
  build({ bin, prompt, sessionId }) {
    const args = [
      "-p",
      "--output-format",
      "json",
      "--permission-mode",
      "acceptEdits",
      "--permission-prompts",
      "none",
    ];
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
