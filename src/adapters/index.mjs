import { agy } from "./agy.mjs";
import { claude } from "./claude.mjs";
import { codex } from "./codex.mjs";
import { cursor } from "./cursor.mjs";
import { gemini } from "./gemini.mjs";

export const adapters = { codex, claude, gemini, agy, cursor };

export function getAdapter(id) {
  return adapters[id] ?? null;
}
