import fs from "node:fs";
import path from "node:path";

export function which(names, env = process.env) {
  const dirs = (env.PATH || "").split(path.delimiter).filter(Boolean);
  for (const name of names) {
    for (const dir of dirs) {
      const full = path.join(dir, name);
      try {
        const stat = fs.statSync(full);
        if (!stat.isFile()) continue;
        fs.accessSync(full, fs.constants.X_OK);
        return full;
      } catch {
        // Try the next PATH entry.
      }
    }
  }
  return null;
}

export function extractJson(stdout) {
  const text = String(stdout || "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    // CLI warnings may sit in front of the JSON object.
  }
  let last = null;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      last = JSON.parse(trimmed);
    } catch {
      // Incomplete NDJSON line while the child is still streaming.
    }
  }
  if (last) return last;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function firstString(obj, keys) {
  if (!obj || typeof obj !== "object") return "";
  for (const key of keys) {
    if (typeof obj[key] === "string" && obj[key]) return obj[key];
  }
  return "";
}

export function messageFromJson(stdout, keys) {
  const text = String(stdout || "");
  let message = "";
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const hit = firstString(JSON.parse(trimmed), keys);
      if (hit) message = hit;
    } catch {
      // Incomplete NDJSON line while the child is still streaming.
    }
  }
  if (message) return message;
  return firstString(extractJson(text), keys);
}

export function sessionFromJson(stdout, keys) {
  const text = String(stdout || "");
  let sessionId = null;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const hit = firstString(JSON.parse(trimmed), keys).trim();
      if (hit) sessionId = hit;
    } catch {
      // Incomplete NDJSON line while the child is still streaming.
    }
  }
  if (sessionId) return sessionId;
  const hit = firstString(extractJson(text), keys).trim();
  return hit || null;
}

export function jsonFailed(stdout) {
  const obj = extractJson(stdout);
  if (!obj) return false;
  if (obj.is_error === true) return true;
  if (typeof obj.status === "string" && !/^success$/i.test(obj.status)) return true;
  return false;
}

export function authHit(text, phrases) {
  const hay = String(text || "").toLowerCase();
  return phrases.some((phrase) => hay.includes(phrase));
}
