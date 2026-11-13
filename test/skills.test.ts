import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (name: string) => fs.readFileSync(new URL(`../skills/${name}/SKILL.md`, import.meta.url), "utf8");

test("skills 带正确 frontmatter，正文保持英文", () => {
  const rescue = read("baton-rescue");
  const orchestrate = read("baton-orchestrate");
  assert.match(rescue, /^name:\s*baton-rescue\s*$/m);
  assert.match(orchestrate, /^name:\s*baton-orchestrate\s*$/m);
  assert.match(rescue, /baton-orchestrate/);
  assert.doesNotMatch(rescue, /[一-鿿]/);
  assert.doesNotMatch(orchestrate, /[一-鿿]/);
});

test("skills 以 shell 命令为主，覆盖 0.3.0 的状态与续轮方式", () => {
  for (const text of [read("baton-rescue"), read("baton-orchestrate")]) {
    for (const needle of ["src/cli.ts", " start ", "wait", "--for 50", "reply", "--as human", "tail -f", "needs_input", "quota_exceeded", "orphaned", "busy"]) {
      assert.ok(text.includes(needle), `缺少 ${needle}`);
    }
    // MCP 只是备选入口，不能要求宿主开后台子 Agent。
    assert.match(text, /MCP/);
    assert.doesNotMatch(text, /must open a (host )?background sub-agent/i);
  }
});

test("skills 不再出现 0.2.x 的旧用法", () => {
  for (const text of [read("baton-rescue"), read("baton-orchestrate")]) {
    for (const old of ["task_wait_any", "timeout_seconds", "effective_timeout_seconds", "1800", "needs_decision", "session_id", "gemini"]) {
      assert.ok(!text.includes(old), `仍含旧用法 ${old}`);
    }
  }
});
