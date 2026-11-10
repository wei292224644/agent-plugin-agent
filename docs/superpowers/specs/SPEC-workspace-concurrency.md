# Spec: workspace-concurrency

日期：2026-11-10  
Module: `workspace-concurrency`（Issue #8）  
状态：已完成（2026-11-10）  
证据：`5892d43`；并行测试绿；Issue #8 已关。

## Objective

Issue #8 报告：同一工作区已有一单在跑时，再 `delegate_task` 返回 `status: busy`，不能并行。

当前 `main`（`5892d43`）源码里已无 `busy` 路径；`delegate` 可同时 `track` 多单；测试 `missing binary, auth failure, timeout, parallel runs, and re-entry` 已断言第二单 `status: "running"`；MCP / skill 文案写明可同时派多单。

本 module 目标：**核实行为与文档一致，用证据关闭 #8**。不实现排队（`queued`），不实现写入范围声明。

## ASSUMPTIONS

1. 核实范围是当前仓库 `main`，不回滚到 0.2.0 发行物再修。
2. 成功 = 自动化测试证明第二单可 `running` + issue 关闭说明指向证据；不需要再写新功能。
3. 若核实发现 `busy` 仍存在：最小修复是删掉互斥锁并保现有并行测试，仍不做排队/范围。
→ 纠正现在，或批了再进 Plan。

## Tech Stack

Node ESM，现有 `src/runner.mjs` / `test/baton.test.mjs`，`npm test`。

## Commands

```bash
npm test
node --test --test-name-pattern 'parallel'
```

## Project Structure

- 核实：`src/runner.mjs`（`delegate`）、`src/mcp.mjs`、`skills/baton-rescue/SKILL.md`、`README*.md`
- 测试：`test/baton.test.mjs` 中并行断言
- 本规格：`docs/superpowers/specs/SPEC-workspace-concurrency.md`

## Code Style

沿用现有 runner / 测试风格。本 module 预期零或极少代码改动。

## Testing Strategy

以现有并行测试为证。核实清单：

1. `git grep busy -- src` 无命中。
2. `npm test` 中并行用例通过：同一 `cwd` 两单均 `running`，且可用各自 `task_id` 查询/取消。
3. README / skill / MCP 描述与行为一致（已写“可同时派多单”则不改）。

若任一项失败，再按失败点最小修补，并补一条回归测试后重跑。

## Boundaries

- Always：先核实再关 issue；关 issue 时评论写明证据（测试名 + 提交）。
- Ask first：引入排队、写入范围、工作区锁。
- Never：为了关 issue 改无关模块；静默忽略失败的并行测试。

## Success Criteria

- [ ] `git grep busy -- src` 为空（或仅文档历史无关）。
- [ ] `npm test` 全绿，且并行断言仍在。
- [ ] Issue #8 关闭，评论指向测试与当前 `main` 提交。
- [ ] 无排队 / 写入范围相关 API。

## Open Questions

无。若核实发现仍有 `busy`，在 Plan 阶段把“删除互斥”写成实现任务，不回头改本规格目标。
