import { agy } from "./agy.ts";
import { claude } from "./claude.ts";
import { codex } from "./codex.ts";
import { cursor } from "./cursor.ts";
import type { Adapter } from "../types.ts";
export const adapters: Record<string, Adapter> = { codex, claude, cursor, agy };
export function getAdapter(id: string): Adapter | null { return Object.hasOwn(adapters, id) ? adapters[id] : null; }
