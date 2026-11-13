import fs from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { taskDir } from "./store.ts";
import { status } from "./tasks.ts";
import { StringDecoder } from "node:string_decoder";
import type { BatonEvent } from "./types.ts";

export function formatEvent(event: BatonEvent): string {
  const prefix = `[${event.ts}] 第 ${event.turn} 轮`;
  switch (event.type) {
    case "turn_started": return `${prefix} ${event.author}: ${event.prompt_preview}`;
    case "message": return `${prefix} ${event.text}`;
    case "tool_call": return `${prefix} 调用 ${event.name}: ${event.detail}`;
    case "tool_result": return `${prefix} ${event.name} ${event.ok ? "成功" : "失败"}: ${event.detail}`;
    case "error": return `${prefix} 错误: ${event.text}`;
    case "raw": return `${prefix} ${event.stream}: ${event.line}`;
    case "turn_ended": return `${prefix} 结束: ${event.status} (exit ${event.exit_code})`;
  }
}

export async function tail(id: string, options: { follow?: boolean; raw?: boolean } = {}): Promise<void> {
  status(id);
  const file = path.join(taskDir(id), "events.jsonl");
  let offset = 0;
  let pending = "";
  const decoder = new StringDecoder("utf8");
  const drain = () => {
    let fd: number;
    try { fd = fs.openSync(file, "r"); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    try {
      const buffer = Buffer.alloc(64 * 1024);
      let bytes: number;

      while ((bytes = fs.readSync(fd, buffer, 0, buffer.length, offset)) > 0) {
        offset += bytes;
        pending += decoder.write(buffer.subarray(0, bytes));
      }
      let newline: number;
      while ((newline = pending.indexOf("\n")) !== -1) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        if (line) process.stdout.write(`${options.raw ? line : formatEvent(JSON.parse(line) as BatonEvent)}\n`);
      }
    } finally { fs.closeSync(fd); }
  };
  for (;;) {
    drain();
    if (!options.follow) return;
    if (status(id).status !== "running") { drain(); return; }
    await sleep(100);
  }
}
