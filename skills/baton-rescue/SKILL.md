---
name: baton-rescue
description: >-
  Hands a bounded coding task to another local agent CLI (codex, claude,
  cursor, agy) through the baton CLI, waits in bounded steps, answers its
  questions, and relays the result. Use proactively when implementation,
  debugging, or a second pass should run in another agent environment, when
  the user says rescue or asks to hand work to Codex, Claude, Agy, or Cursor,
  and when a baton task is waiting in needs_input.
---

# Baton Rescue

Hand one bounded piece of work to another local CLI. The work runs in its own detached process with its state on disk under `~/.baton`, so it survives this session, an MCP restart, or a closed terminal. You drive it with short shell commands. Do not finish the work yourself.

For splitting into several jobs, dependencies, or fail-over: use `baton-orchestrate`.

## The command

Every command prints one JSON object. Call it as:

```
node <plugin-root>/src/cli.ts <command> ...
```

`<plugin-root>` is the directory that contains `src/cli.ts` (two levels above this skill's directory). If `baton` is on `PATH`, `baton <command>` is the same thing. Below, `baton` means either form.

The same operations also exist as MCP tools (`delegate_task`, `task_wait`, `task_reply`, `task_status`, `task_cancel`, `task_list`, `list_agents`). Use MCP only when the host cannot run shell commands; the behavior is identical.

## When to delegate

Delegate:

- An implementation, a debug pass, or a second try in another agent environment
- The user says rescue, hand off, or names another vendor

Stay in the current session:

- One or two small edits, explaining the current diff, or answering a question
- `node <plugin-root>/src/cli.ts agents` fails or lists nothing installed: tell the user, then stop

## Who to send it to

If the user names a target, use it: `codex`, `claude`, `cursor`, `agy`.

If not named, use `codex`. If the current session is already Codex, use `claude`. Never delegate to the vendor you are already running as. Say which target you picked before you start.

## Start

```
baton start --target <t> --prompt "<self-contained task>" [--file <path>...] [--effort low|medium|high|ultra] [--idle-timeout <s>] [--max-duration <s>]
```

- The prompt states done criteria and which files to look at. Long prompts can come on stdin instead of `--prompt`.
- `--effort low` suits mechanical subtasks; it maps to each CLI's native flag.
- `--idle-timeout` (default 600) stops the job only after that many seconds with no output at all. There is no total time cap unless you pass `--max-duration`. Raise `--idle-timeout` for models that think silently for a long time.
- It returns at once with `task_id` and `status: "running"`. Keep the `task_id`. Tell the user they can watch live with `baton tail -f <task_id>`.

## Wait

```
baton wait <task_id> --for 50
```

Returns as soon as the job leaves `running`, or after 50 seconds with the `running` view. Repeat until it is not `running`. Each call is short, so no host tool timeout is hit. If the host can run a long background shell command, a longer `--for` is fine; that is optional.

While `running`, read `liveness`:

- `active`: output in the last 60s. Keep waiting.
- `quiet`: alive but silent for `quiet_for_s` seconds. Usually thinking; keep waiting. Use `baton tail <task_id>` to see the last events.
- `orphaned`: the supervisor died. The next read finalizes it as `failed`.

## After it stops

- `success`: tell the user `summary` and the turn's `git_changes`. Do not redo those edits.
- `needs_input`: the worker asked `decision.question` with `decision.options`. Ask the user unchanged and wait. Then:
  ```
  baton reply <task_id> --as human --prompt "<the user's answer>"
  ```
  Answer it yourself (default `--as host`) only when the user's earlier instructions already decide it. Every turn, its author, and its prompt are recorded under `turns/`, so this is visible later. Then wait again.
- `failed`, `not_authenticated`, `cancelled`: relay `summary`, then stop.
- `quota_exceeded`: relay `summary` and stop. Do not switch vendor on your own.
- `timed_out`: relay `summary` (it says `idle` or `max_duration`). The task is closed; if the user wants another try, `baton start` again with a larger `--idle-timeout`.
- `not_installed`: say so and stop.

`baton reply` also works after `success` for a follow-up in the same conversation. While the job is `running`, `reply` returns `busy`; wait first.

## Other commands

- `baton status <task_id>`: one look, no waiting.
- `baton tail <task_id> [-f] [--raw]`: readable event log; `-f` follows until the job stops.
- `baton cancel <task_id>`: stop it (kills the whole process group). Use when the user wants to stop.
- `baton ls [--all]`: jobs for this directory (or all), newest first.
