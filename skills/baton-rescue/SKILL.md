---
name: baton-rescue
description: Hands a bounded coding task to another local agent CLI through the baton MCP tools delegate_task, task_wait, and task_cancel. Use proactively when implementation, debugging, or a second pass should run in another agent environment, when the user says rescue or asks to hand work to Codex, Claude, Agy, or Cursor, when delegate_task returns running, and when a previous task_wait returned needs_decision for the same session.
---

# Baton Rescue

把一块有边界的工作下放到另一家本地 CLI。主会话调用 MCP 工具 `delegate_task`。这一下马上返回。子进程还在跑时，主会话开一个后台子 Agent 去守 `task_wait`，自己不要等，也不要轮询。不要自己拼 shell，也不要自己把这块做完。

要拆多单、并行、失败换家、由代理选 CLI：改用 `baton-orchestrate`。

## 什么时候下放

下放：

- 一块实现、排错，或换一个 Agent 环境再做一遍
- 用户说 rescue、下放、交给另一家

留在当前会话：

- 一两处小改、解释当前 diff、问一个问题
- `delegate_task` 不在工具列表里。告诉用户 baton MCP 没连上，然后停下

## 派给谁

用户点了名就用那一家：`codex`、`claude`、`gemini`、`agy`、`cursor`。

没点名时用 `codex`。当前会话已经是 Codex 时用 `claude`。不要派给自己所在的那一家。

调用前先说一句派给谁。

## 调用

`delegate_task`：

- `target_agent`：上面选定的那一家
- `prompt`：自洽的任务。写清做完的标准，以及要看的文件
- `files`：知道路径就带上
- 这是同一次任务的后续时，带上一个 `session_id`
- 同一工作区可以同时有多单。已有一单 `running` 时，下一单仍然直接 `delegate_task`，不要等前一单结束。会不会改到同一批文件，由当前会话判断

## 返回之后

- 这次调用已经给出终态（`success`、`failed`、`timed_out`、`not_installed`、`not_authenticated`、`cancelled`）：把 `summary` 告诉用户。`success` 时带上 `git_changes`。不要在当前会话里重做这些修改。
- `running`：告诉用户派给了谁，记住返回的 `task_id`。立刻开一个当前宿主的后台子 Agent 去守这一单。Cursor 用后台 Task。Claude Code 用后台 Agent。主会话不等这个子 Agent，也不要自己把活做掉。后台子 Agent 的工具列表里没有 `task_wait` 时，不要派它，改由主会话自己调用 `task_wait`。
- 守候子 Agent 只做一件事：调用 `task_wait`，传入这个 `task_id`，把返回原样交回。不要轮询 `task_status`，不要开 shell，不要再调用 `delegate_task`。守候者是宿主自己的子 Agent，不是再派一个 baton worker。
- 守候者交回 `success`：把 `summary` 和 `git_changes` 告诉用户。不要在当前会话里重做这些修改。
- 守候者交回 `needs_decision`：把 `question` 和 `options` 原样问用户。等回答。再用同一个 `session_id` 调用 `delegate_task`，`prompt` 只写用户的选择。若又是 `running`，再开一个后台守候者。不要替用户选，也不要新开一轮无关任务。
- 守候者交回 `failed`、`timed_out`、`not_authenticated`、`cancelled`：转告 `summary`，然后停下。不要在当前会话里把活做掉。
- 用户要停：主会话调用 `task_cancel`，带上这一单的 `task_id`，把结果告诉用户。不要等守候者先返回。
- 当前宿主没有后台子 Agent：主会话自己调用 `task_wait` 守到结束。不要改成轮询 `task_status`，也不要挂 shell。
- `task_status` 只用于看一眼。不用它等结束。
