import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { codex } from "../src/adapters/codex.ts";
import { which, authHit } from "../src/adapters/common.ts";
import { getAdapter } from "../src/adapters/index.ts";

test("codex fixture 解析消息、命令、文件修改和失败，未知行不丢弃", () => {
  const lines = fs.readFileSync(new URL("fixtures/codex.stream.jsonl", import.meta.url), "utf8").trim().split("\n");
  assert.equal(codex.sessionIdFrom(lines[0]), "thread-fake-1");
  const events = lines.flatMap((line) => codex.parseLine(line) ?? []);
  assert.deepEqual(events.map((event) => event.type), ["tool_call", "tool_result", "tool_call", "tool_result", "message", "error"]);
  assert.ok(events.some((event) => event.type === "message" && event.text.includes("BATON_RESULT")));
  assert.ok(events.some((event) => event.type === "tool_result" && event.ok));
  for (const line of ["bad json", "null", "{}", '{"type":"item.completed","item":{}}']) assert.equal(codex.parseLine(line), null);
  const long = codex.parseLine(JSON.stringify({ type: "item.started", item: { type: "command_execution", command: "x".repeat(300) } }));
  assert.ok(long?.[0].type === "tool_call");
  assert.equal(long[0].detail.length, 200);
  assert.equal(codex.sessionIdFrom("no JSON"), null);
  assert.equal(codex.isAuthFailure("Please log in"), true);
});

test("codex 0.167.0 真实输出：生命周期事件静默，error 项转 error，不留 raw", () => {
  const lines = fs.readFileSync(new URL("fixtures/codex-0.167.0.stream.jsonl", import.meta.url), "utf8").trim().split("\n");
  for (const line of lines) assert.notEqual(codex.parseLine(line), null, line);
  const events = lines.flatMap((line) => codex.parseLine(line) ?? []);
  assert.deepEqual(events.map((e) => e.type), ["error", "error", "message"]);
});

function fixture(name: string): string[] {
  return fs.readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf8").trim().split("\n");
}

test("cursor 真实 stream-json：session、工具、消息，思考增量不出事件，不留 raw", () => {
  const cursor = getAdapter("cursor")!;
  const lines = fixture("cursor-2026.11.11.stream.jsonl");
  assert.equal(cursor.sessionIdFrom(lines[0]), "ac43faa4-c292-43be-83ce-3dca1fa125cf");
  for (const line of lines) assert.notEqual(cursor.parseLine(line), null, line);
  const events = lines.flatMap((line) => cursor.parseLine(line) ?? []);
  assert.deepEqual(events.map((e) => e.type), ["message", "tool_call", "tool_result", "message"]);
  assert.deepEqual(events[2], { ...events[2], name: "shell", ok: true, detail: "cat a.txt" });
  const last = events.at(-1);
  assert.equal(last?.type === "message" && last.text, "hi");
});

test("模型与档位同时传给 codex/claude/agy，fresh 和 resume 均保留", () => {
  for (const target of ["codex", "claude", "agy"]) {
    const adapter = getAdapter(target)!;
    for (const sessionId of [null, "session-1"]) {
      const input = { bin: "fake", cwd: "/w", prompt: "p", sessionId, reasoningEffort: "low" as const, model: "chosen-model" };
      const { args } = adapter.build(input);
      assert.equal(args[args.indexOf("--model") + 1], "chosen-model", target);
      assert.ok(target === "codex" ? args.includes('model_reasoning_effort="low"') : args.includes("--effort"));
      if (sessionId) assert.ok(args.includes(sessionId));
      assert.ok(!adapter.build({ ...input, model: undefined }).args.includes("--model"));
    }
  }
});

test("Cursor 从实际模型列表选档位，保留 fast，不忽略不支持的组合", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "baton-cursor-model-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bin = path.join(dir, "cursor-agent");
  fs.writeFileSync(bin, "#!/bin/sh\n[ \"$1\" = models ] || exit 2\ncat <<'MODELS'\nAvailable models\nclaude-opus-4-8-low - Opus Low\nclaude-opus-4-8-high - Opus High\nclaude-opus-4-8-max - Opus Max\nclaude-opus-4-8-low-fast - Opus Low Fast\ngpt-5.3-codex-high - Codex High\ngpt-5.3-codex-xhigh - Codex Extra High\ncomposer-2.5 - Composer\nMODELS\n", { mode: 0o755 });
  const cursor = getAdapter("cursor")!;
  for (const sessionId of [null, "session-1"]) {
    const input = { bin, cwd: "/w", prompt: "p", sessionId, reasoningEffort: "low" as const, model: "claude-opus-4-8-high" };
    for (const [model, reasoningEffort, expected] of [
      ["claude-opus-4-8-high", "low", "claude-opus-4-8-low"],
      ["claude-opus-4-8", "ultra", "claude-opus-4-8-max"],
      ["gpt-5.3-codex-high", "ultra", "gpt-5.3-codex-xhigh"],
      ["claude-opus-4-8-low-fast", "low", "claude-opus-4-8-low-fast"],
    ] as const) {
      const { args } = cursor.build({ ...input, model, reasoningEffort });
      assert.equal(args[args.indexOf("--model") + 1], expected);
      if (sessionId) assert.ok(args.includes(sessionId));
    }
    assert.throws(() => cursor.build({ ...input, model: "composer-2.5" }), /effort/);
    assert.throws(() => cursor.build({ ...input, model: "claude-opus-4-8-high-fast", reasoningEffort: "high" }), /effort/);
    assert.throws(() => cursor.build({ ...input, model: undefined }), /model/);
    assert.throws(() => cursor.build({ ...input, model: "auto" }), /model/);
    const { args } = cursor.build({ ...input, bin: "unused", model: "custom[effort=high]", reasoningEffort: null });
    assert.equal(args[args.indexOf("--model") + 1], "custom[effort=high]");
    assert.ok(!cursor.build({ ...input, bin: "unused", model: undefined, reasoningEffort: null }).args.includes("--model"));
  }
  fs.writeFileSync(bin, "#!/bin/sh\necho 'catalog unavailable' >&2\nexit 1\n", { mode: 0o755 });
  assert.throws(() => cursor.build({ bin, cwd: "/w", prompt: "p", sessionId: null, model: "claude-opus-4-8", reasoningEffort: "low" }), /catalog unavailable/);
});

test("agy 真实 stream-json：工具步骤成对，完整回复只从 result 出一次，不留 raw", () => {
  const agy = getAdapter("agy")!;
  const lines = fixture("agy-1.5.6.stream.jsonl");
  assert.equal(agy.sessionIdFrom(lines[0]), "9c0bfa4e-4c5c-4b0c-bd90-ff90c173e27c");
  for (const line of lines) assert.notEqual(agy.parseLine(line), null, line);
  const events = lines.flatMap((line) => agy.parseLine(line) ?? []);
  assert.deepEqual(events.map((e) => e.type), ["tool_call", "tool_result", "message"]);
  assert.equal(events[2].type === "message" && events[2].text, "hi\n");
  const failed = agy.parseLine(JSON.stringify({ event: "result", result: { status: "ERROR", response: "boom" } }));
  assert.deepEqual(failed?.map((e) => e.type), ["error"]);
  assert.deepEqual(agy.build({ bin: "a", cwd: "/w", prompt: "p", sessionId: "c1", reasoningEffort: "ultra" }).args,
    ["--print", "p", "--mode", "accept-edits", "--output-format", "stream-json", "--effort", "max", "--conversation", "c1"]);
});

test("claude 真实 stream-json：hook/init/thinking/限流不出事件，工具成对，不留 raw", () => {
  const claude = getAdapter("claude")!;
  const lines = fixture("claude-2.1.323.stream.jsonl");
  assert.equal(claude.sessionIdFrom(lines[0]), null);
  assert.equal(claude.sessionIdFrom(lines[1]), "46c0d693-4fe0-4bcf-be41-33ebe2cc57fc");
  for (const line of lines) assert.notEqual(claude.parseLine(line), null, line);
  const events = lines.flatMap((line) => claude.parseLine(line) ?? []);
  assert.deepEqual(events.map((e) => e.type), ["tool_call", "tool_result", "message"]);
  assert.deepEqual(events[0], { ...events[0], name: "Bash", detail: "cat a.txt" });
  assert.deepEqual(events[1], { ...events[1], ok: true, detail: "hi" });
  const failed = claude.parseLine(JSON.stringify({ type: "result", subtype: "error_during_execution", is_error: true, result: "boom" }));
  assert.deepEqual(failed?.map((e) => e.type), ["error"]);
  assert.deepEqual(claude.build({ bin: "c", cwd: "/w", prompt: "p", sessionId: "s1", reasoningEffort: "ultra" }).args,
    ["-p", "--output-format", "stream-json", "--verbose", "--permission-mode", "acceptEdits", "--permission-prompts", "none", "--effort", "max", "--resume", "s1", "p"]);
});

test("cursor 优先解析 cursor-agent，再退到 agent", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "baton-bin-"));
  for (const name of ["agent", "cursor-agent"]) { fs.writeFileSync(path.join(dir, name), "#!/bin/sh\n"); fs.chmodSync(path.join(dir, name), 0o755); }
  assert.equal(getAdapter("cursor")!.resolve({ PATH: dir }), path.join(dir, "cursor-agent"));
  fs.rmSync(path.join(dir, "cursor-agent"));
  assert.equal(getAdapter("cursor")!.resolve({ PATH: dir }), path.join(dir, "agent"));
});

test("codex build 沿用 fresh/resume 与四档 effort 参数", () => {
  for (const reasoningEffort of ["low", "medium", "high", "ultra"] as const) {
    for (const sessionId of [null, "thread-9"]) {
      const spec = codex.build({ bin: "/fake/codex", cwd: "/work", prompt: "hello", sessionId, reasoningEffort });
      assert.equal(spec.stdin, "hello");
      assert.ok(spec.args.includes(`model_reasoning_effort="${reasoningEffort}"`));
      assert.ok(!spec.args.includes("--sandbox"));
      assert.ok(!spec.args.includes("--ephemeral"));
      if (sessionId) {
        assert.deepEqual(spec.args.slice(0, 3), ["exec", "resume", "--json"]);
        assert.equal(spec.args.at(-2), sessionId);
        assert.ok(!spec.args.includes("--cd"));
        assert.ok(!spec.args.includes("--color"));
      } else assert.ok(spec.args.includes("--approve-for-me"));
    }
  }
  assert.equal(getAdapter("codex"), codex);
  assert.equal(getAdapter("missing"), null);
  assert.equal(getAdapter("__proto__"), null);
  assert.equal(getAdapter("constructor"), null);
});

test("fake CLI 通过 PATH 解析，按 fixture 输出并支持退出码", () => {
  const dir = path.join(import.meta.dirname, "fake-cli");
  const env = { ...process.env, PATH: dir, FAKE_FIXTURE: path.join(import.meta.dirname, "fixtures/codex.stream.jsonl"), FAKE_SLEEP: "0", FAKE_EXIT: "0", FAKE_HANG: "0" };
  const bin = which(["codex"], env);
  assert.equal(bin, path.join(dir, "codex"));
  assert.match(execFileSync(bin!, [], { env, encoding: "utf8", input: "prompt" }), /thread.started/);
  assert.throws(() => execFileSync(bin!, [], { env: { ...env, FAKE_EXIT: "3" }, input: "prompt" }), (error: unknown) => (error as { status: number }).status === 3);
  assert.equal(which(["missing"], env), null);
  assert.ok(authHit("NOT LOGGED IN", ["not logged in"]));
});
