import { authHit, jsonFailed, messageFromJson, sessionFromJson, which } from "./common.mjs";

const AUTH = ["error authenticating", "ineligibletiererror", "not logged in"];

export const gemini = {
  id: "gemini",
  resolve(env) {
    return which(["gemini"], env);
  },
  build({ bin, prompt, sessionId, reasoningEffort }) {
    const args = ["-p", prompt, "--output-format", "json", "--skip-trust", "--approval-mode", "auto_edit"];
    if (sessionId) args.push("--resume", sessionId);
    return {
      command: bin,
      args,
      stdin: null,
      warning: reasoningEffort ? "gemini 暂不支持按单指定 reasoning_effort，保持默认配置。" : undefined,
    };
  },
  sessionIdFrom(stdout) {
    return sessionFromJson(stdout, ["session_id"]);
  },
  messageFrom(stdout) {
    return messageFromJson(stdout, ["response", "result"]);
  },
  failed: jsonFailed,
  isAuthFailure(text) {
    return authHit(text, AUTH);
  },
};
