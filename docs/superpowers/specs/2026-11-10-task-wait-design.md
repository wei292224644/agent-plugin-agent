# Spec: 宿主后台子 Agent 守 `task_wait`

日期：2026-11-10  
状态：已确认

## Objective

`delegate_task` 在 worker 还活着时就返回 `running`。MCP 没有「做完了」的推送，主会话要么轮询 `task_status`，要么另挂 shell。主会话自己把调用堵到结束，当前回合会被占住。

修好的是谁握住这次长调用：

1. 主会话调用 `delegate_task`，马上拿到 `task_id`，然后继续干活。
2. 主会话开一个**当前宿主自己的后台子 Agent**（Cursor 的后台 Task，Claude Code 的后台 Agent）。
3. 守候者只调用 `task_wait(task_id)`，挂到 worker 结束，把最终结果交回。宿主在子 Agent 结束时叫醒主会话。
4. baton 照旧拉起真正干活的 CLI。

成功标准：主会话不被长调用占住；结束靠宿主的子 Agent 完成通知；中间不出现 shell，也不把 `task_status` 当等待循环。

## 已定假设

1. 守候者是宿主的后台子 Agent，不是再用 baton 派出去的 worker。
2. `delegate_task` 继续秒回。`task_id` 留在主会话，停止用 `task_cancel`。
3. `needs_decision` 从 `task_wait` 原样回到主会话，由主会话问用户。
4. 没有后台子 Agent 的宿主，由主会话自己调用 `task_wait`。纯查询仍用 `task_status`。
5. 等待期间发 `notifications/progress`，躲开 Claude Code 约 30 分钟的空闲超时。客户端没给 `progressToken` 时不发。

## Contract

`task_wait` 参数：`task_id`（必填）。

- worker 还在当前进程里：阻塞到 `complete` 写入最终结果，返回和结束后的 `task_status` 相同的对象（`success`、`needs_decision`、`failed`、`timed_out`、`cancelled`）。
- 调用时已经结束：立刻返回该结果。
- 缺少 `task_id`，或内存和落盘都没有这一单：`status: "failed"`，`summary` 为 `缺少 task_id。` 或 `没有这一单派工。`
- 落盘状态已是终态，但当前进程没有这单：返回落盘结果。
- 落盘仍是 `running`，当前进程没有这单：立刻 `failed`，`summary` 为 `这一单不在当前进程里，没法守着。` 不挂起。
- 等待期间约每 15 秒回调一次进度（测试可改间隔）。回调抛错不影响等待。进度只在仍为 `running` 时发出。
- `task_wait` 不取消 worker。取消仍走 `task_cancel`。守候调用中途断开时 worker 继续跑。

MCP 层把进度编成 `notifications/progress`：`progress` 从 1 递增，`message` 取当前输出的最后一行，最长 200 字。没有 `progressToken` 时返回空，不发送。

CLI：`baton wait --task <id>`，阻塞到结束，把同一个 JSON 打到 stdout。这是现有 CLI 的子命令，不是新的可执行入口。

## Commands

```bash
npm test
node --test --test-name-pattern taskWait
node src/cli.mjs wait --task <id>
```

## Project Structure

- `src/runner.mjs`：`taskWait`，以及 `complete` 时解开的等待。
- `src/mcp.mjs`：注册 `task_wait`，发送 progress。
- `src/cli.mjs`：`wait` 子命令。
- `skills/baton-rescue/SKILL.md`：主会话派完即开后台守候者。
- `test/baton.test.mjs`：等待、取消、进度、缺单。
- `README.md`、`README.zh-CN.md`：把「随后轮询 `task_status`」改成这条路径。

## Code Style

沿用 `runner.mjs`：小函数、早返回、状态字符串用现有中文摘要。工具名保持 `task_wait`。不新增依赖。

## Testing Strategy

`node --test`。用现有假子进程。断言：

- 活着的子进程上 `taskWait` 在 `close` 之后返回 `success`。
- 等待期间进度回调看到的是 `running`；回调抛错仍能返回 `success`。
- 等待中 `taskCancel` 让 `taskWait` 返回 `cancelled`。
- 已经结束的一单立刻返回。
- 未知 id、缺 id、落盘仍为 `running` 但不在本进程，都不挂起。

## Boundaries

- Always：先有失败测试再改 `taskWait`；`delegate_task` 的秒回行为保持不变。
- Ask first：改超时上限、改工作区锁、加新的可执行入口。
- Never：用 shell 轮询当主路径；守候者里面再 `delegate_task`；`task_wait` 顺手杀掉 worker。

## Success Criteria

- `npm test` 通过，其中包含上面的 `taskWait` 断言。
- skill 写明：`running` 之后开宿主后台子 Agent 调 `task_wait`；主会话不等、不轮询、不开 shell。
- `task_status` 仍可看一眼，文档不再把它写成等待方式。

## Open Questions

无。
