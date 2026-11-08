import { authHit, jsonFailed, messageFromJson, sessionFromJson, which } from "./common.mjs";

const AUTH = ["not logged in", "please log in", "authentication required"];

export const agy = {
  id: "agy",
  resolve(env) {
    return which(["agy"], env);
  },
  build({ bin, prompt, sessionId }) {
    const args = ["--print", prompt, "--mode", "accept-edits", "--output-format", "json"];
    if (sessionId) args.push("--conversation", sessionId);
    return { command: bin, args, stdin: null };
  },
  sessionIdFrom(stdout) {
    return sessionFromJson(stdout, ["conversation_id", "session_id"]);
  },
  messageFrom(stdout) {
    return messageFromJson(stdout, ["response", "result"]);
  },
  failed: jsonFailed,
  isAuthFailure(text) {
    return authHit(text, AUTH);
  },
};
