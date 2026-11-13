import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { agents, cancel, ls, reply, start, status, wait } from "./tasks.ts";
import { redact } from "./redact.ts";
import type { Author, Effort } from "./types.ts";

const MAX_WAIT_SECONDS = 55;
const PROGRESS_MS = 15_000;

// 每个工具只转调 tasks.ts；MCP 进程里不保存任何任务状态，重启后照样能读到任务。
async function respond(run: () => unknown): Promise<{ content: { type: "text"; text: string }[] }> {
  let value: unknown;
  try { value = await run(); } catch (error) {
    value = { status: "failed", summary: redact((error as Error).message) };
  }
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

export function createServer(): McpServer {
  const server = new McpServer({ name: "baton", version: "0.3.0" });
  server.registerTool("list_agents", { description: "列出本机可派工的 CLI 及是否安装。" }, () => respond(() => ({ agents: agents() })));
  server.registerTool("delegate_task", {
    description: "把一个有边界的任务派给本机另一个 AI CLI。立即返回 task_id（status=running），任务在独立进程里跑，不受本 MCP 进程或宿主会话退出影响。之后用 task_wait 有界等待。",
    inputSchema: {
      target_agent: z.enum(["codex", "claude", "cursor", "agy"]),
      prompt: z.string(),
      files: z.array(z.string()).optional(),
      model: z.string().optional().describe("目标 CLI 的模型名；与 reasoning_effort 一起保存，并在 reply 时沿用。"),
      reasoning_effort: z.enum(["low", "medium", "high", "ultra"]).optional(),
      idle_timeout_seconds: z.number().optional().describe("连续这么久没有任何输出就停掉，默认 600。"),
      max_duration_seconds: z.number().optional().describe("单轮总时长上限，默认不限。"),
      cwd: z.string().optional(),
    },
  }, (args) => respond(() => start({
    target: args.target_agent, prompt: args.prompt, files: args.files, cwd: args.cwd,
    model: args.model, reasoningEffort: args.reasoning_effort as Effort | undefined,
    idleTimeout: args.idle_timeout_seconds, maxDuration: args.max_duration_seconds,
  })));
  server.registerTool("task_status", {
    description: "看一单当前状态。running 时带 liveness（active/quiet/orphaned）和 quiet_for_s。",
    inputSchema: { task_id: z.string() },
  }, (args) => respond(() => status(args.task_id)));
  server.registerTool("task_wait", {
    description: `有界等待：任一任务离开 running 即返回该任务；到 wait_seconds（默认 50，上限 ${MAX_WAIT_SECONDS}）仍在跑就返回 running，调用方再次调用即可。`,
    inputSchema: { task_ids: z.array(z.string()).min(1), wait_seconds: z.number().optional() },
  }, (args, extra) => respond(async () => {
    const seconds = Math.min(Math.max(args.wait_seconds ?? 50, 0), MAX_WAIT_SECONDS);
    const token = extra?._meta?.progressToken;
    let step = 0;
    const timer = token == null ? null : setInterval(() => {
      step += 1;
      const quiet = args.task_ids.map((id) => { try { return `${id.slice(0, 8)} ${status(id).quiet_for_s ?? "?"}s 无输出`; } catch { return id; } }).join("; ");
      extra.sendNotification({ method: "notifications/progress", params: { progressToken: token, progress: step, message: quiet } }).catch(() => {});
    }, PROGRESS_MS);
    try { return await wait(args.task_ids, seconds); } finally { if (timer) clearInterval(timer); }
  }));
  server.registerTool("task_reply", {
    description: "任务停在 needs_input 或 success 后，在同一会话开下一轮。as=human 表示这是人说的话，默认 host。running 时返回 busy。",
    inputSchema: { task_id: z.string(), prompt: z.string(), as: z.enum(["host", "human"]).optional() },
  }, (args) => respond(() => reply(args.task_id, args.prompt, (args.as ?? "host") as Author)));
  server.registerTool("task_cancel", {
    description: "停掉一单还在跑的任务（杀整个进程组）。",
    inputSchema: { task_id: z.string() },
  }, (args) => respond(() => cancel(args.task_id)));
  server.registerTool("task_list", {
    description: "列出任务，按更新时间倒序。默认只列 cwd（或 BATON_CWD）下的任务，all=true 列全部。",
    inputSchema: { all: z.boolean().optional(), cwd: z.string().optional() },
  }, (args) => respond(() => ({ tasks: ls(args.all ?? false, args.cwd ?? process.env.BATON_CWD ?? process.cwd()) })));
  return server;
}

export async function startMcp(): Promise<void> {
  await createServer().connect(new StdioServerTransport());
}
