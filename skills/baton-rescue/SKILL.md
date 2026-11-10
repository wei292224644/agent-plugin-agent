---
name: baton-rescue
description: Hands a bounded coding task to another local agent CLI through the baton MCP tools delegate_task, task_wait, and task_cancel. Use proactively when implementation, debugging, or a second pass should run in another agent environment, when the user says rescue or asks to hand work to Codex, Claude, Agy, or Cursor, when delegate_task returns running, and when a previous task_wait returned needs_decision for the same session.
---

# Baton Rescue

Hand a bounded piece of work to another local CLI. The main session calls the MCP tool `delegate_task`. That call returns immediately. While the child is still running, open a background sub-agent to watch with `task_wait`. Do not wait in the main session, and do not poll. Do not invent a shell command, and do not finish the work yourself.

For splitting into multiple tasks, running in parallel, failing over to another CLI, or letting an agent choose the target: use `baton-orchestrate`.

## When to delegate

Delegate:

- An implementation, a debug pass, or a second try in another agent environment
- The user says rescue, hand off, or name another vendor

Stay in the current session:

- One or two small edits, explaining the current diff, or answering a question
- `delegate_task` is missing from the tool list. Tell the user baton MCP is not connected, then stop

## Who to send it to

If the user names a target, use it: `codex`, `claude`, `gemini`, `agy`, `cursor`.

If not named, use `codex`. If the current session is already Codex, use `claude`. Never delegate to the vendor you are already running as.

Say which target you picked before you call.

## Call

`delegate_task`:

- `target_agent`: the vendor chosen above
- `prompt`: a self-contained task. State done criteria and which files to look at
- `files`: include paths when you know them
- When this is a continuation of the same job, pass the same `session_id`
- The same workspace may run several jobs at once. If one is already `running`, still call `delegate_task` for the next; do not wait for the first to finish. Whether those jobs would touch the same files is for the current session to decide

## After the return

- The call already returned a terminal status (`success`, `failed`, `timed_out`, `not_installed`, `not_authenticated`, `cancelled`): tell the user the `summary`. On `success`, include `git_changes`. Do not redo those edits in the current session.
- `running`: tell the user who got the job, keep the `task_id`. Immediately open a host background sub-agent to watch that job. Cursor: background Task. Claude Code: background Agent. The main session does not wait on that sub-agent and does not finish the work itself. If the background sub-agent's tool list has no `task_wait`, do not open it; call `task_wait` from the main session instead.
- The watcher does one thing only: call `task_wait` with that `task_id` and return the payload as-is. Do not poll `task_status`, do not open a shell, do not call `delegate_task` again. The watcher is a host sub-agent, not another baton worker.
- Watcher returns `success`: tell the user `summary` and `git_changes`. Do not redo those edits in the current session.
- Watcher returns `needs_decision`: ask the user the `question` and `options` unchanged. Wait for the answer. Call `delegate_task` again with the same `session_id`; `prompt` is only the user's choice. If that returns `running`, open another watcher. Do not choose for the user, and do not start an unrelated new job.
- Watcher returns `failed`, `timed_out`, `not_authenticated`, or `cancelled`: relay `summary`, then stop. Do not finish the work in the current session.
- User wants to stop: the main session calls `task_cancel` with that `task_id` and reports the result. Do not wait for the watcher first.
- Host has no background sub-agent: the main session calls `task_wait` itself until the job ends. Do not poll `task_status`, and do not hang a shell.
- `task_status` is for a peek only. Do not use it to wait for completion.
