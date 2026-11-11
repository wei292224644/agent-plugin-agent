# Spec: 失败摘要优先显示终止原因

日期：2026-11-11
状态：已确认
Issue：#25
Module：failure-summary

## Objective

worker 因额度用尽失败时，`task_wait` 返回 `failed`，`summary` 却是 rmcp 传输错误和一整页 HTML。真正的原因只在 `output` 里，例如 `turn.failed: You've hit your usage limit.`

编排者读 `summary` 就要能换家，不用翻 `output`，也不用解析 HTML。

成功标准：同一次失败的 `summary` 以终止原因开头；HTML 不出现在 `summary`；额度用尽的 `status` 是 `quota_exceeded`，不是 `failed`。

## 已定假设

1. 判定放在 `describe()` 一处，扫描原始 stdout 和 stderr。不靠 Codex `messageFrom`。它只抽 `agent_message`，抽不到 `turn.failed`。
2. 终止原因优先于 stderr。有终止原因时，`summary` 就是这句（仍受现有 8192 字尾部限制，但这句放在开头）。没有终止原因时，`summary` 用去掉 HTML 之后的 stderr，stderr 空则用 stdout。
3. HTML 指含 `<!DOCTYPE` 或 `<html` 的片段，整段不进 `summary`。
4. 有终止原因时，rmcp 传输错误行不进 `summary`。
5. 额度用尽用新状态 `quota_exceeded`，不用在 `failed` 上再挂 `reason`。编排 skill 已经按 `status` 分支。
6. 额度短语：`usage limit`、`quota exceeded`、`rate limit`。大小写不敏感。`turn.failed` 只是终止原因的标记，单独出现不代表额度。
7. 登录失败仍是 `not_authenticated`，先于额度判断。现有 auth 测试保持不变。
8. `output` 仍是原来的尾部原文，可以继续含噪音。只改 `summary` 和额度时的 `status`。
9. `baton-orchestrate`：`quota_exceeded` 与 `not_authenticated` 相同，换下一家，不耗在同一家。`baton-rescue` 只转述 `summary` 然后停下。救援是单目标，不在这里换家。

## Contract

`describe()` 在 `cancelled`、`timed_out` 之后：

1. 文本命中现有登录失败短语：`status` 为 `not_authenticated`。行为不变。
2. 否则文本命中额度短语：`status` 为 `quota_exceeded`。`summary` 是终止原因；没有单独的终止行时，`summary` 是命中的那句额度原文。
3. 否则沿用现在的 `needs_decision` / `success` / `failed`。`failed` 的 `summary` 改为「终止原因，否则去 HTML 后的 stderr/stdout」。

终止原因：stdout 或 stderr 里，`turn.failed` 这一行，或 JSON 事件里 type 为 `turn.failed` 的 message / error 文本。取最后一条。

`output`、`exit_code`、`git_changes`、`session_id` 的形状不变。

## Commands

```bash
npm test
node --test --test-name-pattern "failure summary"
```

## Project Structure

- `src/runner.mjs`：`describe()` 里选 `summary` 和 `quota_exceeded`。
- `test/baton.test.mjs`：假子进程覆盖额度、HTML、普通失败。
- `skills/baton-orchestrate/SKILL.md`：`quota_exceeded` 换家。
- `skills/baton-rescue/SKILL.md`：转述 `quota_exceeded` 后停下。

## Code Style

沿用 `runner.mjs`：小函数、早返回、中文 `summary` 只在我们自己写的句子里使用。从 worker 原文抽出的原因保持原文，不翻译。不新增依赖，不改各 adapter 的 `messageFrom`。

## Testing Strategy

`node --test`，用现有假子进程。断言：

- stdout 含 `turn.failed: You've hit your usage limit.`，stderr 含 rmcp 行和 `<html>` 页：`status` 为 `quota_exceeded`；`summary` 含 `usage limit`；`summary` 不含 `rmcp`、不含 `<html`。
- stdout 含 `turn.failed: disk full`，stderr 是 HTML：`status` 为 `failed`；`summary` 含 `disk full`；不含 `<html`。
- stderr 只有 `Please run /login`：仍是 `not_authenticated`。
- 没有终止行、没有 HTML 的普通失败：`summary` 仍能看到 stderr 正文。

## Boundaries

- Always：先有失败测试再改 `describe()`；登录失败保持 `not_authenticated`。
- Ask first：再增加别的 `status`（例如单独的 `rate_limited`）。
- Never：把 HTML 或 rmcp 噪音留在有终止原因的 `summary` 里；为了摘要去改 `output` 的形状；在 rescue 里自动换家。

## Success Criteria

- 上面四条测试通过，`npm test` 全绿。
- 额度用尽时编排 skill 写明换家；rescue skill 写明转述后停下。
- `src/adapters/codex.mjs` 的 `messageFrom` 不改。

## Open Questions

无。版本升到 `0.2.5`，两单一起发。
