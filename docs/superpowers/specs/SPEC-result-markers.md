# Spec: result-markers

日期：2026-11-10  
Module: `result-markers`（Issue #10）  
状态：已完成（2026-11-10）

## Objective

插件已改名 baton，子 Agent 输出契约仍用 `APA_RESULT` / `APA_DECISION` / `APA_END`。改为 `BATON_*`，解析一段时间同时兼容旧 `APA_*`。README 写一句改名说明（仓库名/安装串仍是 `agent-plugin-agent`）。

## ASSUMPTIONS

1. 新标记：`BATON_DECISION` / `BATON_RESULT` / `BATON_END`，行格式与现有 `question:` / `options:` / `summary:` 不变。
2. `interpret` 新旧都认；`OUTPUT_CONTRACT`（注入给下游的说明）只教新标记。
3. 测试夹具逐步改为新标记，至少留一条旧标记兼容断言。
4. 不改 marketplace / package 名。
→ 纠正现在，或批了再进 Plan。

## Tech Stack

现有 `src/runner.mjs`（`OUTPUT_CONTRACT`、`interpret`）、测试与 README。

## Commands

```bash
npm test
node --test --test-name-pattern 'interpret'
```

## Project Structure

- `src/runner.mjs`：契约文案 + `interpret` 正则
- `test/baton.test.mjs`：标记断言
- `README.md` / `README.zh-CN.md`：改名一句说明
- 本规格：`docs/superpowers/specs/SPEC-result-markers.md`

## Code Style

沿用 runner；标记名全大写 + 下划线。

## Testing Strategy

- `interpret`：新标记 decision/result；旧 `APA_*` 仍可解析。
- 现有委派成功路径测试改用新标记后仍绿。

## Boundaries

- Always：注入契约用新标记；解析兼容旧标记。
- Ask first：删掉旧标记兼容、改仓库名。
- Never：改 MCP 工具名或 package 名当本 module 的一部分。

## Success Criteria

- [ ] 下游 prompt 契约出现 `BATON_RESULT` / `BATON_DECISION` / `BATON_END`，不再教 `APA_*`。
- [ ] `interpret` 认新旧两套。
- [ ] `npm test` 绿。
- [ ] README 中英各有一句 apa→baton 改名说明。
- [ ] 可关 #10。

## Open Questions

无。
