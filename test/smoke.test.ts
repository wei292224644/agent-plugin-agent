import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("Node 原生运行 TypeScript，工具链只做类型检查", () => {
  const value: number = 24;
  assert.ok(Number(process.versions.node.split(".")[0]) >= value);
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.engines.node, ">=24");
  assert.equal(pkg.scripts.typecheck, "tsc --noEmit");
});
