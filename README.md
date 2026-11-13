# Baton

**English** | [简体中文](README.zh-CN.md)

> A local compute bridge for AI agents: **Any Agent as Host, Any Agent as Worker**.
> The CLI/IDE you are using is the Host. It hands bounded coding tasks to other agent CLIs installed on the same machine (Workers), spending their subscriptions. Each task runs in its own process with its state on disk, can run as long as it needs, and can be watched at any time.

Delegation targets: `claude` (Claude Code), `codex` (Codex CLI), `cursor` (Cursor Agent CLI), `agy` (Antigravity).

> **0.3.0 is a breaking release.** See [Upgrading from 0.2.x](#upgrading-from-02x).

---

## Table of Contents

- [How It Works](#how-it-works)
- [Installation](#installation)
- [Verify Installation](#verify-installation)
- [Usage](#usage)
  - [Skills in the host](#skills-in-the-host)
  - [Command line](#command-line)
  - [Statuses and liveness](#statuses-and-liveness)
  - [Questions and follow-up turns (needs_input / reply)](#questions-and-follow-up-turns-needs_input--reply)
  - [MCP tools](#mcp-tools)
- [Task directory ~/.baton](#task-directory-baton)
- [Underlying Calling Conventions](#underlying-calling-conventions)
- [Safety](#safety)
- [Manual Smoke Testing](#manual-smoke-testing)
- [Development & Testing](#development--testing)
- [Upgrading from 0.2.x](#upgrading-from-02x)

---

## How It Works

```
Host CLI ──shell──> baton start ──spawns a detached supervisor──> baton _supervise <id>
   │                    │ (returns task_id at once)                 │ owns the worker's process group
   │                    ▼                                           │ parses streamed output → events
   │            ~/.baton/tasks/<id>/  <──────── single writer ──────┘
   │                    ▲
   └──shell/MCP──> baton status / wait / tail / reply / cancel / ls
```

- **Tasks outlive the host**: the supervisor runs on its own. Closing the host session, restarting MCP, or closing the terminal does not stop the task, and its result can still be read afterwards.
- **No total time cap**: by default only an idle timeout applies (stop after 600 seconds with no output at all), so slow models can run for hours.
- **Visible progress**: each CLI's streamed output becomes uniform events (messages, tool calls, tool results, errors). Watch them live with `baton tail -f`; `status` says whether the worker is busy, quietly thinking, or whether its supervisor died.
- **Turn-based interaction**: when the worker stops to ask a question, a human or the host agent continues the same conversation with `baton reply`. Every turn and its author are recorded.
- **No extra API keys**: reuses each CLI's existing login and subscription.

---

## Installation

Installation differs by harness. Simply copy and paste the commands for your preferred Host environment below.

### Prerequisites

1. **Node.js** >= 24 (runs the TypeScript source directly, no build step)
2. At least one supported Agent CLI installed and logged in locally (`codex`, `claude`, `agy`, or `cursor`).
3. After a marketplace install, run `/baton:setup` in the host session. Marketplace install does not run `npm install`; without this step MCP exits because `@modelcontextprotocol/sdk` is missing.
4. (Optional) If installing from local source or developing:
   ```bash
   git clone https://github.com/wei292224644/agent-plugin-agent.git
   cd agent-plugin-agent
   npm install
   ```

---

### Claude Code

Claude Code supports plugins via its plugin marketplace.

#### Remote One-Click Install (Recommended)

Run directly in your system terminal:

```bash
claude plugin marketplace add https://github.com/wei292224644/agent-plugin-agent
claude plugin install baton@agent-plugin-agent
```

Or inside an active `claude` session using Slash commands:

```text
/plugin marketplace add https://github.com/wei292224644/agent-plugin-agent
/plugin install baton@agent-plugin-agent
```

#### Local Checkout Install

From inside your local `agent-plugin-agent` directory:

```bash
claude plugin marketplace add .
claude plugin install baton@agent-plugin-agent
```

---

### Antigravity (agy)

Antigravity natively discovers plugins and auto-loads their skills.

#### Remote One-Click Install (Recommended)

Run in your terminal:

```bash
agy plugin install https://github.com/wei292224644/agent-plugin-agent
```

#### Local Checkout Install

From inside your local `agent-plugin-agent` directory:

```bash
agy plugin install .
```

> **Update**: Re-running the same install command updates the plugin to the latest version.

---

### Codex CLI

Codex CLI supports adding plugin marketplaces and registering MCP tools.

#### Terminal Command Install

Run in your system terminal:

```bash
codex plugin marketplace add https://github.com/wei292224644/agent-plugin-agent
codex plugin add baton@agent-plugin-agent
```

#### Interactive TUI Install

Inside an interactive `codex` session:

```text
/plugins
```

Search for `baton` and select `Install Plugin`.

#### Local Checkout Install

From inside your local `agent-plugin-agent` directory:

```bash
codex plugin marketplace add .
codex plugin add baton@agent-plugin-agent
```

---

### Codex App

For the Codex desktop application:

1. Open Codex App and navigate to **Plugins** in the sidebar.
2. Search for `Baton` (or add custom marketplace source: `https://github.com/wei292224644/agent-plugin-agent`).
3. Click **Install**.

---

### Cursor (Agent CLI & IDE)

#### Cursor Agent CLI Install

Cursor's official Agent CLI accepts Git repositories:

```bash
agent plugin marketplace add https://github.com/wei292224644/agent-plugin-agent
agent plugin install baton@agent-plugin-agent
```

Or in the Cursor Agent chat window:

```text
/add-plugin baton
```

#### Cursor IDE (MCP Mode)

If using the Cursor editor interface, configure it directly as an MCP server.

In your project's `.cursor/mcp.json` (or global Cursor MCP Settings):

```json
{
  "mcpServers": {
    "baton": {
      "command": "node",
      "args": ["<ABSOLUTE_PATH_TO_REPO>/src/cli.ts", "mcp"]
    }
  }
}
```

---

### Gemini CLI

Gemini CLI uses an extension system. This installs baton into Gemini CLI as the host; delegating tasks to gemini is not supported in 0.3.0.

#### Remote Install

Run in your terminal:

```bash
gemini extensions install https://github.com/wei292224644/agent-plugin-agent
```

#### Local Link Mode (For development)

From inside your local `agent-plugin-agent` directory:

```bash
gemini extensions link .
```

#### Update Extension

```bash
gemini extensions update baton
```

---

### Generic MCP Clients (Claude Desktop / Windsurf / etc.)

Baton exposes a standard Stdio MCP server compatible with any MCP client (including Claude Desktop, Windsurf, Zed, Cline, Roo Code).

Add the following to your client's MCP configuration JSON:

```json
{
  "mcpServers": {
    "baton": {
      "command": "node",
      "args": ["<ABSOLUTE_PATH_TO_REPO>/src/cli.ts", "mcp"]
    }
  }
}
```

---

## Verify Installation

```bash
node src/cli.ts agents
```

Example output:

```json
{"agents":[{"id":"codex","installed":true,"bin":"/opt/homebrew/bin/codex","version":"codex-cli 0.167.0"},{"id":"claude","installed":true,"bin":"/Users/user/.local/bin/claude","version":"2.1.323 (Claude Code)"},{"id":"cursor","installed":true,"bin":"/Users/user/.local/bin/cursor-agent","version":"2026.11.11-043ef28"},{"id":"agy","installed":true,"bin":"/Users/user/.local/bin/agy","version":"1.5.6"}]}
```

Only agents with `installed: true` can be delegation targets.

---

## Usage

### Skills in the host

After installation the host loads three skills:

- [skills/setup/SKILL.md](skills/setup/SKILL.md): `/baton:setup`, installs the plugin's npm dependencies
- [skills/baton-rescue/SKILL.md](skills/baton-rescue/SKILL.md): one hop, bounded waiting, relays or answers the worker's questions
- [skills/baton-orchestrate/SKILL.md](skills/baton-orchestrate/SKILL.md): several jobs with a dependency graph, per-job review, rework, fail-over, and a summary (does not require Speckit / OpenSpec / agent-skills)

Say something like "rescue this refactor to Codex" and the host runs `baton start` through its shell, then repeats `baton wait --for 50` until the job stops. The skills rely only on shell commands; they do not need the host to have background sub-agents.

**Routing**: use the target the user names. Otherwise implementation and debugging go to `codex`, or to `claude` when the current session is already Codex. Never delegate to yourself.

### Command line

Every command prints exactly one JSON object (except `tail`) and exits non-zero on error. `baton` below means `node <plugin-root>/src/cli.ts`.

```bash
baton agents
baton start --target <codex|claude|cursor|agy> [--prompt <text> | stdin] [--file <p>...] [--model <name>] [--effort low|medium|high|ultra]
            [--idle-timeout <s>] [--max-duration <s>] [--cwd <dir>]
baton status <id>
baton wait <id>... [--for <s>]       # default 50; returns the first job that leaves running, or the running view on timeout
baton tail <id> [-f] [--raw]         # readable events; -f follows until the job stops; --raw prints events.jsonl lines
baton reply <id> [--prompt <text> | stdin] [--as host|human]
baton cancel <id>
baton ls [--all]                     # jobs for the current directory by default, newest first
baton prune --older <days>           # delete non-running task directories older than N days
baton mcp                            # start the MCP server (stdio)
```

- `--model` selects the target CLI's model. Omit it to use that CLI's default. Model and effort are saved per task and reused on every `reply`.
- `--effort` maps to each CLI's native flag: Codex `-c model_reasoning_effort=...`; Claude/Agy `--effort` (`ultra` becomes `max`). These CLIs validate model names and supported effort combinations themselves.
- For Cursor, use `cursor-agent models` to find model IDs. With both options set, Baton selects a matching effort variant from that live list, preserving `-fast`; `ultra` chooses `max`, then `xhigh` or `extra-high` if available. For example, `--model claude-opus-4-8 --effort low` selects `claude-opus-4-8-low`. Unsupported combinations fail explicitly. Auto cannot take an independent effort: select a model when passing `--effort`.
- Cursor's [CLI reference](https://cursor.com/docs/cli/reference/parameters) documents `--model`. The local 2026.11.11 help also advertises bracket overrides, but this account rejects partial forms such as `auto[effort=low]`; Baton therefore uses listed model IDs when combining options. A model supplied without `--effort` is passed through unchanged.
- `--idle-timeout` defaults to 600: the job stops only after that many seconds without a single output byte. `--max-duration` is unlimited by default. Both apply per turn and restart on `reply`.

### Statuses and liveness

| `status` | Meaning |
|---|---|
| `running` | Still working; includes `liveness` and `quiet_for_s` |
| `needs_input` | The worker asked a question; `decision` holds `question` and `options` |
| `success` | Turn finished; includes `summary` and this turn's `git_changes` |
| `failed` / `timed_out` / `cancelled` | Terminal; cannot be replied to |
| `not_authenticated` / `quota_exceeded` | The target CLI is not logged in / out of quota |
| `not_installed` | Returned by `start`; the target is not on `PATH` |

`liveness` while `running`:

| `liveness` | Condition |
|---|---|
| `active` | Output within the last 60 seconds |
| `quiet` | Supervisor alive but silent for more than 60 seconds (usually thinking) |
| `orphaned` | Supervisor gone or heartbeat older than 30 seconds; the next read kills leftover processes and records `failed` |

### Questions and follow-up turns (needs_input / reply)

Baton appends an output contract to every prompt: ask with a `BATON_DECISION` block when a choice is needed, finish with a `BATON_RESULT` block. When the worker asks, the task moves to `needs_input` and the worker process exits normally.

```bash
baton reply <id> --as human --prompt "A"
```

- Starts the next turn in the same conversation. `--as human` marks the words as the user's; the default `--as host` is for answers the host gives from the user's earlier instructions.
- `reply` also works after `success` for a follow-up. While the job is `running`, `reply` returns `busy`.
- Each turn's author, input, and result are stored in `turns/<n>.json`.

### MCP tools

MCP is a thin shell over the same logic. It keeps no task state, so restarting MCP does not affect running jobs:

| Tool | Command |
|---|---|
| `list_agents` | `agents` |
| `delegate_task` | `start` (`target_agent`, `prompt`, `files`, `model`, `reasoning_effort`, `idle_timeout_seconds`, `max_duration_seconds`, `cwd`) |
| `task_status` | `status` |
| `task_wait` | `wait` (`task_ids`, `wait_seconds` default 50, max 55; sends a progress notification every 15 seconds) |
| `task_reply` | `reply` (`task_id`, `prompt`, `as`) |
| `task_cancel` | `cancel` |
| `task_list` | `ls` (`all`, `cwd`) |

---

## Task directory ~/.baton

The root is `~/.baton` by default; set `BATON_HOME` to move it. Directories are `0700` and files `0600` (they contain prompts).

```
~/.baton/tasks/<task_id>/
  meta.json          current state (atomic writes)
  events.jsonl       uniform event stream
  turns/<n>.json     turn n: author, input, final status, summary, git_changes
  raw/<n>.stdout.log raw worker output for turn n, not truncated
  raw/<n>.stderr.log
```

Task directories are never deleted automatically; use `baton prune --older <days>`.

---

## Underlying Calling Conventions

| Agent | First call | Resume | Notes |
| :--- | :--- | :--- | :--- |
| **Codex** | `codex exec --json --color never --approve-for-me --skip-git-repo-check --cd <cwd> -` | `codex exec resume --json <thread_id> -` | `--approve-for-me` already uses the workspace-write sandbox and conflicts with `--sandbox`; `exec resume` rejects `--cd` and `--color` |
| **Claude Code** | `claude -p --output-format stream-json --verbose --permission-mode acceptEdits --permission-prompts none` | add `--resume <session_id>` | `stream-json` with `-p` requires `--verbose`; hook events stay out of the event stream |
| **Cursor** | `cursor-agent --print --force --trust --output-format stream-json --workspace <cwd>` | add `--resume <session_id>` | Prefers `cursor-agent`, then `agent`; never the IDE's `cursor` |
| **Antigravity (agy)** | `agy --print <prompt> --mode accept-edits --output-format stream-json` | add `--conversation <id>` | Replies stream as deltas; the full text comes from the final `result` |

Any output line a parser does not recognize is kept as a `raw` event, never dropped. Real output samples for each CLI live in `test/fixtures/`.

---

## Safety

1. **No recursion (`BATON_DELEGATION=1`)**: set in the worker's environment; a downstream call into baton is refused.
2. **Process groups**: each worker runs in its own process group; timeouts and `cancel` kill the whole group, grandchildren included.
3. **Credential redaction**: text written to events and summaries is redacted before truncation; full raw logs stay under `raw/`, protected by `0600`.
4. **Id validation**: every task id is checked to be a UUID before it is used in a path.

---

## Manual Smoke Testing

Use a separate throwaway Git repository:

1. `baton agents`; confirm the target shows `installed: true`.
2. Start a task that stops to ask:
   ```bash
   baton start --target codex --effort low --prompt "Do not edit files. Stop and ask me: A or B, using the BATON_DECISION format, options: A | B."
   ```
3. In another terminal, `baton tail -f <id>` shows events live.
4. Repeat `baton wait <id> --for 50` until it returns `needs_input` with A/B in `decision`.
5. `baton reply <id> --as human --prompt "A. Reply with the letter, then finish with BATON_RESULT."`, wait until `success`, and check that `session_id` matches turn 1.

---

## Development & Testing

```bash
npm test          # tsc --noEmit + node --test, no real model quota used
npm run typecheck
```

Integration tests use fake CLIs in `test/fake-cli/` and a temporary `BATON_HOME`. They cover: a task finishing after its parent is killed, idle and total timeouts, cancel killing the whole group, orphan detection after the supervisor dies, needs_input → reply on the same session, bounded wait, tail, ls/prune, and reading tasks after an MCP restart. Adapter tests use real output samples from each CLI.

---

## Upgrading from 0.2.x

- **Node 24 or newer.** The source is now TypeScript and runs directly as `src/cli.ts`.
- The entry point moved from `src/cli.mjs` to `src/cli.ts`; update any hand-written MCP config.
- The CLI drops `delegate` in favor of `start` + `wait` + `reply`; `wait` takes ids as positional arguments.
- MCP drops `delegate_task(session_id)` continuation and `task_wait_any`: continue with `task_reply`, wait on several jobs with `task_wait(task_ids)`.
- `needs_decision` is now `needs_input`. `timeout_seconds` (capped at 1800) is replaced by `idle_timeout_seconds` + `max_duration_seconds`, with no total cap by default.
- Task state moved from the system temp directory to `~/.baton`.
- **gemini is not a delegation target for now** (it could not be verified because of a local auth problem). Installing baton as an extension inside Gemini CLI as the host still works.

---

Formerly named **Agent-Plugin-Agent (APA)**. The old install string `apa@apa` is no longer valid; use `baton@agent-plugin-agent`.
