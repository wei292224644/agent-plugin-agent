import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import type { ExecFileOptions } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import type { TestContext } from "node:test";
import type { TaskMeta, BatonEvent, Turn } from "../src/types.ts";

export const cli = path.resolve(import.meta.dirname, "../src/cli.ts");
export function exec(file: string, args: string[], options: ExecFileOptions): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile(file, args, { ...options, encoding: "utf8" }, (error, stdout, stderr) => {
      if (error) reject(Object.assign(error, { stdout, stderr })); else resolve({ stdout, stderr });
    });
    child.stdin?.end();
  });
}
export { sleep };
export function sandbox(t: TestContext) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "baton-integration-"));
  const cwd = path.join(home, "work");
  fs.mkdirSync(cwd);
  const fixture = path.join(home, "fixture.jsonl");
  fs.writeFileSync(fixture, `${JSON.stringify({ type: "thread.started", thread_id: "thread-fake-1" })}\n${JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "BATON_RESULT\nsummary: ok\nBATON_END" } })}\n`);
  const env: NodeJS.ProcessEnv = { ...process.env, BATON_HOME: home, BATON_DELEGATION: "0", PATH: `${path.join(import.meta.dirname, "fake-cli")}:/usr/bin:/bin`, FAKE_FIXTURE: fixture, FAKE_SLEEP: "0", FAKE_EXIT: "0", FAKE_HANG: "0" };
  t.after(() => {
    const root = path.join(home, "tasks");
    if (fs.existsSync(root)) for (const id of fs.readdirSync(root)) {
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(root, id, "meta.json"), "utf8")) as TaskMeta;
        if (meta.status === "running") {
          if (meta.supervisor_pid) try { process.kill(meta.supervisor_pid, "SIGKILL"); } catch {}
          if (meta.child_pid) try { process.kill(-meta.child_pid, "SIGKILL"); } catch {}
        }
      } catch {}
    }
    fs.rmSync(home, { recursive: true, force: true });
  });
  async function run<T = TaskMeta & { liveness?: string; quiet_for_s?: number }>(...args: string[]): Promise<T> {
    const result = await exec(process.execPath, [cli, ...args], { cwd, env, timeout: 8000 });
    return JSON.parse(result.stdout);
  }
  const dir = (id: string) => path.join(home, "tasks", id);
  const meta = (id: string): TaskMeta => JSON.parse(fs.readFileSync(path.join(dir(id), "meta.json"), "utf8"));
  const turn = (id: string, n = 1): Turn => JSON.parse(fs.readFileSync(path.join(dir(id), "turns", `${n}.json`), "utf8"));
  const events = (id: string): BatonEvent[] => fs.readFileSync(path.join(dir(id), "events.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
  async function until(id: string, predicate: (meta: TaskMeta) => boolean = (meta) => meta.status !== "running", timeout = 6000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) { const m = meta(id); if (predicate(m)) return m; await sleep(20); }
    throw new Error(`任务未达到预期状态: ${JSON.stringify(meta(id))}`);
  }
  return { home, cwd, env, fixture, run, dir, meta, turn, events, until };
}
