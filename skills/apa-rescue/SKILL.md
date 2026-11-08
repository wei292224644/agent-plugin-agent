---
name: apa-rescue
description: Hands a bounded coding task to another local agent CLI through the apa MCP tool delegate_task. Use proactively when implementation, debugging, or a second pass should run in another agent environment, when the user says rescue or asks to hand work to Codex, Claude, Agy, or Cursor, and when a previous delegate_task returned needs_decision for the same session.
---

# APA Rescue

把一块有边界的工作下放到另一家本地 CLI。调用 MCP 工具 `delegate_task`。不要自己拼 shell，也不要自己把这块做完。

## 什么时候下放

下放：

- 一块实现、排错，或换一个 Agent 环境再做一遍
- 用户说 rescue、下放、交给另一家

留在当前会话：

- 一两处小改、解释当前 diff、问一个问题
- `delegate_task` 不在工具列表里。告诉用户 apa MCP 没连上，然后停下

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

## 返回之后

- `success`：把 `summary` 和 `git_changes` 告诉用户。不要在当前会话里重做这些修改。
- `needs_decision`：把 `question` 和 `options` 原样问用户。等回答。再用同一个 `session_id` 调用 `delegate_task`，`prompt` 只写用户的选择。不要替用户选，也不要新开一轮。
- `failed`、`timed_out`、`not_installed`、`not_authenticated`、`busy`：转告 `summary`，然后停下。不要在当前会话里把活做掉。
