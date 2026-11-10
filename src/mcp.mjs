import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { delegate, listAgents, progressNotification, taskCancel, taskStatus, taskWait } from "./runner.mjs";

const targets = ["codex", "claude", "gemini", "agy", "cursor"];

function text(value) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

export async function startMcp() {
  const server = new McpServer({ name: "baton", version: "0.2.3" });
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
        "把一个有边界的任务派给本机另一个 AI CLI，花对方订阅里的额度。子 Agent 进程还活着才返回 running 和 task_id。同一工作区可以同时派多单。主会话拿到 task_id 后开一个后台子 Agent 调 task_wait 守到结束，不要轮询，也不要挂 shell。要停用 task_cancel。返回 needs_decision 时，把用户的选择和同一个 session_id 再派一次。不要派小改动。",
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
      description: "看一眼一单派工。进行中返回时长、最近输出、last_output_at 和目前的 git_changes。结束后返回最终结果。传 task_id 看这一单。不传 task_id 时，只有一单在跑才默认选中它；有多单则返回 tasks 清单。等结束用 task_wait，不要用这个工具轮询。",
      inputSchema: z.object({
        task_id: z.string().optional(),
      }),
    },
    async (args) => text(taskStatus({ taskId: args.task_id })),
  );
  server.registerTool(
    "task_cancel",
    {
      description: "停掉一单还在跑的派工。传 task_id 停这一单。不传 task_id 时，只有一单在跑才停它；有多单则不会停，并返回 task_ids。",
      inputSchema: z.object({
        task_id: z.string().optional(),
      }),
    },
    async (args) => text(taskCancel({ taskId: args.task_id })),
  );
  server.registerTool(
    "task_wait",
    {
      description: "守着一单派工，直到结束才返回最终结果。传入 delegate_task 返回的 task_id。进行中发送进度通知。这一单不在当前进程里时立刻失败。不要轮询 task_status。",
      inputSchema: z.object({
        task_id: z.string(),
      }),
    },
    async (args, extra) => {
      let step = 0;
      return text(await taskWait({
        taskId: args.task_id,
        onProgress: (view) => {
          step += 1;
          const note = progressNotification(extra, step, view);
          if (!note || !extra?.sendNotification) return undefined;
          return extra.sendNotification(note);
        },
      }));
    },
  );
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
