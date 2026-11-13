#!/usr/bin/env node
import fs from "node:fs";
import { parseArgs } from "node:util";
import { agents, start, status, cancel, wait, reply, ls, prune } from "./tasks.ts";
import { redact } from "./redact.ts";
import type { Author, Effort } from "./types.ts";

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  let result: unknown;
  if (command === "_supervise") {
    if (args.length !== 1) throw new Error("缺少 task_id。");
    await (await import("./supervisor.ts")).supervise(args[0]);
    return;
  }
  if (command === "mcp") {
    await (await import("./mcp.ts")).startMcp();
    return;
  }
  if (command === "agents") {
    result = { agents: agents() };
  } else if (command === "start") {
    const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
      target: { type: "string" }, prompt: { type: "string" }, cwd: { type: "string" },
      file: { type: "string", multiple: true }, effort: { type: "string" },
      "idle-timeout": { type: "string" }, "max-duration": { type: "string" },
    } });
    if (positionals.length) throw new Error("start 不接受位置参数。");
    result = await start({ target: values.target || "", prompt: values.prompt ?? fs.readFileSync(0, "utf8"), cwd: values.cwd, files: values.file,
      reasoningEffort: values.effort as Effort | undefined,
      idleTimeout: values["idle-timeout"] === undefined ? undefined : Number(values["idle-timeout"]), maxDuration: values["max-duration"] === undefined ? undefined : Number(values["max-duration"]),
    });
    if ((result as { status: string }).status !== "running") process.exitCode = 1;
  } else if (command === "status") {
    if (args.length !== 1) throw new Error("status 需要一个 task_id。");
    result = status(args[0]);
  } else if (command === "reply") {
    const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { prompt: { type: "string" }, as: { type: "string" } } });
    if (positionals.length !== 1) throw new Error("reply 需要一个 task_id。");
    result = await reply(positionals[0], values.prompt ?? fs.readFileSync(0, "utf8"), (values.as ?? "host") as Author);
    if ((result as { status: string }).status !== "running") process.exitCode = 1;
  } else if (command === "wait") {
    const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { for: { type: "string" } } });
    result = await wait(positionals, values.for === undefined ? 50 : Number(values.for));
  } else if (command === "tail") {
    const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { follow: { type: "boolean", short: "f" }, raw: { type: "boolean" } } });
    if (positionals.length !== 1) throw new Error("tail 需要一个 task_id。");
    await (await import("./tail.ts")).tail(positionals[0], { follow: values.follow, raw: values.raw });
    return;
  } else if (command === "ls") {
    const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { all: { type: "boolean" } } });
    if (positionals.length) throw new Error("ls 不接受位置参数。");
    result = { tasks: ls(values.all) };
  } else if (command === "prune") {
    const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { older: { type: "string" } } });
    if (positionals.length || values.older === undefined) throw new Error("prune 需要 --older 天数。");
    result = { deleted: prune(Number(values.older)) };
  } else if (command === "cancel") {
    if (args.length !== 1) throw new Error("cancel 需要一个 task_id。");
    result = await cancel(args[0]);
  } else throw new Error("用法：baton agents | start | status | cancel | wait | tail | reply | ls | prune | mcp");
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

try { await main(); } catch (error) {
  process.stdout.write(`${JSON.stringify({ status: "failed", summary: redact((error as Error).message) })}\n`);
  process.exitCode = 1;
}
