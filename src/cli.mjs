#!/usr/bin/env node
import fs from "node:fs";
import { delegate, listAgents } from "./runner.mjs";
import { startMcp } from "./mcp.mjs";

const usage = `用法:
  apa agents
  apa delegate --target <codex|claude|gemini|agy|cursor> [--prompt <text>] [--session <id>] [--timeout <seconds>] [--file <path>...]
  apa mcp

没有 --prompt 时从 stdin 读取任务。
`;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next == null || next.startsWith("--")) {
      out[key] = true;
      continue;
    }
    if (out[key] == null) out[key] = next;
    else if (Array.isArray(out[key])) out[key].push(next);
    else out[key] = [out[key], next];
    i += 1;
  }
  return out;
}

function asList(value) {
  if (value == null || value === true) return [];
  return Array.isArray(value) ? value : [value];
}

const [command, ...rest] = process.argv.slice(2);

if (command === "mcp") {
  await startMcp();
} else if (command === "agents") {
  process.stdout.write(`${JSON.stringify(listAgents(), null, 2)}\n`);
} else if (command === "delegate") {
  const args = parseArgs(rest);
  let prompt = args.prompt === true ? "" : args.prompt || "";
  if (!prompt && !process.stdin.isTTY) prompt = fs.readFileSync(0, "utf8");
  if (!args.target || args.target === true || !String(prompt).trim()) {
    process.stderr.write(usage);
    process.exit(2);
  }
  const result = await delegate({
    target: args.target,
    prompt,
    files: asList(args.file),
    timeoutSeconds: args.timeout === true ? undefined : args.timeout,
    sessionId: args.session === true ? undefined : args.session,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else {
  process.stderr.write(usage);
  process.exit(2);
}
