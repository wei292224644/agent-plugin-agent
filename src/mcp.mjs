import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { delegate, listAgents } from "./runner.mjs";

const targets = ["codex", "claude", "gemini", "agy", "cursor"];

function text(value) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

export async function startMcp() {
  const server = new McpServer({ name: "apa", version: "0.1.0" });
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
        "把一个有边界的任务派给本机另一个 AI CLI，花对方订阅里的额度。返回 needs_decision 时，把用户的选择和同一个 session_id 再派一次。不要派小改动。",
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
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
