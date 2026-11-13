import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { sandbox, cli } from "./helpers.ts";

async function connect(env: NodeJS.ProcessEnv): Promise<Client> {
  const client = new Client({ name: "test", version: "0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [cli, "mcp"], env: env as Record<string, string> }));
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<any> {
  const result = await client.callTool({ name, arguments: args });
  return JSON.parse((result.content as { text: string }[])[0].text);
}

test("MCP 薄壳：工具清单、派工、有界等待、续轮、列表、取消，状态全在磁盘", async (t) => {
  const s = sandbox(t);
  let client = await connect(s.env);
  t.after(() => client.close());
  const names = (await client.listTools()).tools.map((tool) => tool.name).sort();
  assert.deepEqual(names, ["delegate_task", "list_agents", "task_cancel", "task_list", "task_reply", "task_status", "task_wait"]);
  assert.ok((await call(client, "list_agents")).agents.some((a: any) => a.id === "codex" && a.installed));

  const started = await call(client, "delegate_task", { target_agent: "codex", prompt: "hi", cwd: s.cwd, model: "chosen-model", reasoning_effort: "low" });
  assert.equal(started.status, "running");
  assert.equal(started.model, "chosen-model");
  assert.equal(started.reasoning_effort, "low");
  // MCP 重启后仍能读到同一单：MCP 进程里不保存任务状态。
  await client.close();
  client = await connect(s.env);
  const done = await call(client, "task_wait", { task_ids: [started.task_id], wait_seconds: 10 });
  assert.equal(done.status, "success");
  assert.equal(done.model, "chosen-model");
  assert.equal((await call(client, "task_status", { task_id: started.task_id })).status, "success");

  const again = await call(client, "task_reply", { task_id: started.task_id, prompt: "more", as: "human" });
  assert.equal(again.status, "running");
  assert.equal(again.model, "chosen-model");
  assert.equal(again.reasoning_effort, "low");
  assert.equal((await call(client, "task_wait", { task_ids: [started.task_id], wait_seconds: 10 })).turn, 2);
  assert.ok((await call(client, "task_list", { all: true })).tasks.some((task: any) => task.task_id === started.task_id));

  s.env.FAKE_HANG = "1";
  await client.close();
  client = await connect(s.env);
  const slow = await call(client, "delegate_task", { target_agent: "codex", prompt: "slow", cwd: s.cwd });
  const begin = performance.now();
  assert.equal((await call(client, "task_wait", { task_ids: [slow.task_id], wait_seconds: 1 })).status, "running");
  assert.ok(performance.now() - begin < 3000);
  assert.equal((await call(client, "task_cancel", { task_id: slow.task_id })).status, "cancelled");

  const bad = await call(client, "task_status", { task_id: "../x" });
  assert.equal(bad.status, "failed");
});
