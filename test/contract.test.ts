import test from "node:test";
import assert from "node:assert/strict";
import { interpret, buildPrompt, OUTPUT_CONTRACT } from "../src/contract.ts";
test("interpret reads the last decision or result block", () => {
  const legacy = interpret("noise\nAPA_DECISION\nquestion: 用 Redis 吗？\noptions: Redis | 内存\nAPA_END\n");
  assert.deepEqual(legacy, { kind: "decision", question: "用 Redis 吗？", options: ["Redis", "内存"] });
  const decision = interpret("noise\nBATON_DECISION\nquestion: 用 Redis 吗？\noptions: Redis | 内存\nBATON_END\n");
  assert.deepEqual(decision, { kind: "decision", question: "用 Redis 吗？", options: ["Redis", "内存"] });
  const result = interpret("BATON_RESULT\nsummary: 已改 auth.ts\nBATON_END");
  assert.ok(result && result.kind === "result");
  assert.equal(result.summary, "已改 auth.ts");
  assert.deepEqual(interpret("APA_RESULT\nsummary: 旧标记\nAPA_END"), { kind: "result", summary: "旧标记" });
  assert.equal(interpret("no marker"), null);
});


test("buildPrompt keeps files and output contract", () => {
  assert.equal(buildPrompt(" hi "), `hi\n\n${OUTPUT_CONTRACT}`);
  assert.match(buildPrompt(" hi ", ["src/a.ts"]), /Focus on these files:\n- src\/a.ts\n\nhi/);
});
