---
name: baton-orchestrate
description: Opens a host-side orchestrator sub-agent that picks local CLIs, splits work, delegates via baton MCP (delegate_task / task_wait / task_cancel), may re-dispatch on failure, and returns a summary. Use when the user wants multi-CLI distribution, orchestration, or parallel bounded tasks—not for a single named one-shot rescue (use baton-rescue). Process-agnostic: do not require agent-skills, Speckit, or OpenSpec.
---

# Baton Orchestrate

主控只下目标。开一个**宿主自己的后台子 Agent**当调度（orchestrator）。调度者选 CLI、拆活、派工、守候、必要时换家再派，最后汇总。工人仍是各家本地 CLI。

这是可选用法。单跳下放继续用 `baton-rescue`。

Baton 是运输层，**不绑定**任何工程方法论。工作区若有 `.agents/`、OpenSpec、Speckit 或自研规约，可写进工人 prompt；没有就空手派。

## 角色

| 角色 | 是谁 | 做什么 |
|---|---|---|
| 主控 | 当前会话 | 开调度子 Agent；转达用户停令；收汇总 |
| 调度 | 宿主后台子 Agent | `list_agents`、拆任务、`delegate_task`、`task_wait`、失败换家、汇总 |
| 守候 | 可与调度同一子 Agent，或每单再开一个 | 只 `task_wait`；工具列表没有就调度自己守 |
| 工人 | `codex` / `claude` / `gemini` / `agy` / `cursor` | 改代码；不要在工人里再调 baton |

调度发生在宿主侧。不要派一个 baton worker 再让它去派别人（`BATON_DELEGATION` 会拒）。

## 何时用

用：

- 用户要分发、编排、多 CLI、并行几块有边界的活
- 一块活可能要拆给两家，或失败后换家

不用（改走 `baton-rescue` 或留在主控）：

- 用户已点名一家、只要一跳
- 一两处小改、解释 diff、问问题
- `delegate_task` 不在工具列表里 → 告诉用户 baton 没连上，停下

## 主控怎么开调度

1. 先说一句：开调度子 Agent。
2. Cursor：后台 Task。Claude Code：后台 Agent。
3. 把下面「调度任务书」原样交给它（填入用户目标）。主控不等它跑完中间步骤；结束时收汇总。
4. 用户要停：主控对还在跑的 `task_id` 调 `task_cancel`，并告知调度者。

## 调度任务书（交给子 Agent）

```text
你是 Baton 调度代理（orchestrator），不是工人。

目标：
<用户目标原话>

约束：
- 只通过 baton MCP：list_agents、delegate_task、task_wait、task_cancel
- 不要自己改仓库文件；不要开 shell 轮询
- 不要要求 Speckit / OpenSpec / agent-skills；工作区若已有规约，摘进工人 prompt 即可，没有就省略
- 不要派给当前宿主自己所在的那一家 CLI
- 默认最多同时 3 单 running；需要更多先问主控
- 默认失败换家，不要无故双跑同一改动
- 会改到重叠路径的任务串行；路径不重叠可并行
- 每单 running 后用 task_wait 守到结束（可同会话顺序守，或再开只守 task_wait 的后台子 Agent）
- needs_decision：把 question/options 交回主控，等用户，再带同一 session_id 续派；不要替用户选
- 结束后只交一份汇总：派了谁、各单 status、summary、git_changes、换过谁

步骤：
1. list_agents，只派 installed 的
2. 拆成有边界的子任务（每单自洽 prompt + 建议 files）
3. 选 target_agent 并说明理由（一句）
4. delegate_task；记下 task_id
5. task_wait；失败/超时可换另一家重派同一子任务一次
6. 全部终态后汇总
```

## 选家（调度用）

- 用户点名 → 听用户
- 否则实现/排错默认 `codex`；当前宿主已是 Codex → `claude`
- 调研/长上下文可考虑 `gemini` / `agy`；局部编辑可考虑 `cursor`
- `not_installed` / `not_authenticated` → 换下一家，不要死磕

## 和 baton-rescue 的分工

- 一跳、已点名、简单下放 → `baton-rescue`
- 要拆、要并行、要换家、要汇总 → 本 skill
