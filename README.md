# APA

本地桥。当前 CLI 用一个 MCP 工具把任务派给本机另一家 CLI，花对方订阅里的额度。运行器拼好参数，模型不拼 shell。

支持 `codex`、`claude`、`gemini`、`agy`、`cursor`。

## 命令

```bash
npm install
node src/cli.mjs agents
node src/cli.mjs delegate --target claude --prompt "只回复 pong，不要改文件"
node src/cli.mjs mcp
```

没有 `--prompt` 时从 stdin 读任务。续接加 `--session <上次返回的 session_id>`。

`delegate_task` 的参数是 `target_agent`、`prompt`、可选 `files`、`timeout_seconds`（默认 300，上限 1800）、`session_id`。

返回 `status`：`success`、`needs_decision`、`failed`、`timed_out`、`not_installed`、`not_authenticated`、`busy`。`needs_decision` 带 `question`、`options` 和 `session_id`。把用户的选择连同同一个 `session_id` 再派一次，对方从原会话继续。

同一工作区同时只跑一个派工。子进程带 `APA_DELEGATION=1`，桥再被叫到时直接拒绝。

## 插件

仓库本身就是五份插件，带上 MCP 入口和 `skills/apa-rescue`。先在仓库里 `npm install`，再由你自己安装。下面的命令都会改你本机的插件列表，这里不代跑。

```bash
claude plugin marketplace add <本仓库路径>
claude plugin install apa@apa

codex plugin marketplace add <本仓库路径>
codex plugin add apa@apa

agy plugin install <本仓库路径>

gemini extensions link <本仓库路径>
```

Cursor 的命令只接受 git 地址：`agent plugin marketplace add <仓库 git 地址>`。清单在 `.cursor-plugin/plugin.json`。

## 各家实际调用

- Codex 首次：`codex exec --json --color never --sandbox workspace-write --approve-for-me --cd <cwd> -`。续接：`codex exec resume --json <thread_id> -`。`exec resume` 不接受 `--sandbox`、`--cd`、`--color`。不要加 `--ephemeral`。
- Claude Code：`claude -p --output-format json --permission-mode acceptEdits --permission-prompts none`。续接加 `--resume <session_id>`。
- Gemini：`gemini -p <prompt> --output-format json --skip-trust --approval-mode auto_edit`。续接加 `--resume <session_id>`。
- Agy：`agy --print <prompt> --mode accept-edits --output-format json`。续接加 `--conversation <conversation_id>`。
- Cursor：只找 `cursor-agent` 或 `agent`，不走 IDE 的 `cursor`。`agent --print --force --trust --output-format json --workspace <cwd>`。续接加 `--resume <session_id>`。

## Rescue

宿主侧只有这一份编排：[skills/apa-rescue/SKILL.md](skills/apa-rescue/SKILL.md)。它随上面的插件安装，该下放时自己调用 `delegate_task`。审查、status、cancel 不做。

没点名时，实现和排错派给 Codex。当前会话已经是 Codex 时派给 Claude。点了名就用那一家。

## 手工冒烟

在一个临时 git 仓库里做。任务用「只回复一个词，不要改文件」。

1. `node src/cli.mjs agents`，确认要测的那家 `installed: true`。
2. 对 claude、codex、agy、cursor 各派一次。返回 `success`，`git_changes.files_changed` 为 0，并带有 `session_id`。
3. 用该 `session_id` 再派一次，问它刚才那个词。回答应来自同一会话。
4. Gemini 在已迁移到 Antigravity 的账号上会返回 `not_authenticated`（`IneligibleTierError`）。这台机器上的 Google 额度用 agy。

## 测试

```bash
npm test
```

测试不调用真实模型。
