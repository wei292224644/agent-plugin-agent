import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { delegate, listAgents, taskCancel, taskStatus } from "./runner.mjs";

const targets = ["codex", "claude", "gemini", "agy", "cursor"];

function text(value) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

export async function startMcp() {
  const server = new McpServer({ name: "baton", version: "0.2.0" });
  server.registerTool(
    "list_agents",
    {
      description: "列出本机可派工的 CLI：codex、claude、gemini、agy、cursor。",
      inputSchema: z.object({}),
    },
    async () => text(listAgents()),
  );
  server.registerTool(
    "delegate_task",
    {
      description:
        "把一个有边界的任务派给本机另一个 AI CLI，花对方订阅里的额度。子 Agent 进程还活着才返回 running 和 task_id。用 task_status 看进度和结果。返回 needs_decision 时，把用户的选择和同一个 session_id 再派一次。不要派小改动。",
      inputSchema: z.object({
        target_agent: z.enum(targets),
        prompt: z.string(),
        files: z.array(z.string()).optional(),
        timeout_seconds: z.number().optional(),
        session_id: z.string().optional(),
      }),
    },
    async (args) =>
      text(
        await delegate({
          target: args.target_agent,
          prompt: args.prompt,
          files: args.files,
          timeoutSeconds: args.timeout_seconds,
          sessionId: args.session_id,
        }),
      ),
  );
  server.registerTool(
    "task_status",
    {
      description: "查看一单派工。进行中返回时长、最近输出和目前的 git_changes。结束后返回最终结果。不传 task_id 时看当前工作区的那一单。",
      inputSchema: z.object({
        task_id: z.string().optional(),
      }),
    },
    async (args) => text(taskStatus({ taskId: args.task_id })),
  );
  server.registerTool(
    "task_cancel",
    {
      description: "停掉一单还在跑的派工。不传 task_id 时停当前工作区的那一单。",
      inputSchema: z.object({
        task_id: z.string().optional(),
      }),
    },
    async (args) => text(taskCancel({ taskId: args.task_id })),
  );
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
