# Baton

[English](README.md) | **简体中文**

> 本地 AI Agent 算力桥：**Any Agent as Host, Any Agent as Worker**。
> 当前使用的 CLI/IDE 作为主控（Host），把有边界的代码任务派给本机安装的其他 Agent CLI（Worker），直接消耗对方订阅里的额度。任务在独立进程里跑，状态落在磁盘上，跑多久都行，随时能看它在干什么。

可派工的目标：`claude` (Claude Code)、`codex` (Codex CLI)、`cursor` (Cursor Agent CLI)、`agy` (Antigravity)。

> **0.3.0 是破坏性升级**，见 [从 0.2.x 升级](#从-02x-升级)。

---

## 目录

- [核心工作原理](#核心工作原理)
- [安装指南 (Installation)](#安装指南-installation)
- [验证安装](#验证安装)
- [使用方法](#使用方法)
  - [宿主内的技能](#宿主内的技能)
  - [命令行](#命令行)
  - [状态与存活判定](#状态与存活判定)
  - [停下提问与续轮 (needs_input / reply)](#停下提问与续轮-needs_input--reply)
  - [MCP 工具](#mcp-工具)
- [任务目录 ~/.baton](#任务目录-baton)
- [各平台底层调用规范](#各平台底层调用规范)
- [安全机制](#安全机制)
- [手工冒烟测试](#手工冒烟测试)
- [开发与单元测试](#开发与单元测试)
- [从 0.2.x 升级](#从-02x-升级)

---

## 核心工作原理

```
宿主 CLI ──shell──> baton start ──拉起脱离父进程的守护进程──> baton _supervise <id>
   │                    │ (立即返回 task_id)                     │ 持有子 CLI 进程组
   │                    ▼                                        │ 解析流式输出 → 统一事件
   │            ~/.baton/tasks/<id>/  <──────── 唯一写者 ────────┘
   │                    ▲
   └──shell/MCP──> baton status / wait / tail / reply / cancel / ls
```

- **任务不依附宿主**：守护进程独立运行。宿主会话退出、MCP 重启、终端关掉，任务照常跑完，之后仍能读到结果。
- **没有总时长上限**：默认只有空闲超时（连续 600 秒没有任何输出才停），慢模型跑几个小时也行。
- **过程可见**：各家 CLI 的流式输出被统一成事件（消息、工具调用、工具结果、错误），用 `baton tail -f` 实时看；`status` 直接告诉你它是在动、在安静思考，还是守护进程已经死了。
- **按轮交互**：子 CLI 停下来提问时，人或主 Agent 用 `baton reply` 在原会话里接着说，每一轮谁说了什么都落盘。
- **零额外 API Key**：复用本机各家 CLI 已登录的会话与订阅额度。

---

## 安装指南 (Installation)

不同开发工具的插件与扩展管理方式不同。根据你常用的宿主（Host），直接复制对应的指令即可完成安装。

### 前置要求

1. **Node.js** >= 24（直接运行 TypeScript 源码，无构建步骤）
2. 本地已安装并登录至少一个受支持的 Agent CLI（`codex`、`claude`、`agy`、`cursor`）。
3. 通过插件市场安装后，在宿主会话运行 `/baton:setup`。市场安装不会执行 `npm install`，不跑这一步时 MCP 会因找不到 `@modelcontextprotocol/sdk` 起不来。
4. （可选）如果你打算以源码方式本地安装或二次开发，先克隆本仓库并安装依赖：
   ```bash
   git clone https://github.com/wei292224644/agent-plugin-agent.git
   cd agent-plugin-agent
   npm install
   ```

---

### Claude Code

Claude Code 原生支持通过插件市场进行扩展。

#### 远程一键安装（推荐）

在系统终端中运行：

```bash
claude plugin marketplace add https://github.com/wei292224644/agent-plugin-agent
claude plugin install baton@agent-plugin-agent
```

或者在已开启的 `claude` 交互终端内直接输入 Slash 命令：

```text
/plugin marketplace add https://github.com/wei292224644/agent-plugin-agent
/plugin install baton@agent-plugin-agent
```

#### 本地克隆安装

在克隆好的 `agent-plugin-agent` 目录下执行：

```bash
claude plugin marketplace add .
claude plugin install baton@agent-plugin-agent
```

---

### Antigravity (agy)

Antigravity 原生支持插件系统与技能自动加载。

#### 远程一键安装（推荐）

在终端中直接运行：

```bash
agy plugin install https://github.com/wei292224644/agent-plugin-agent
```

#### 本地克隆安装

在克隆好的 `agent-plugin-agent` 目录下执行：

```bash
agy plugin install .
```

> **更新**：重新执行一次相同的安装指令即可覆盖更新到最新版本。

---

### Codex CLI

Codex 命令行支持通过插件体系注册并接入 MCP。

#### 终端命令安装

在系统终端中运行：

```bash
codex plugin marketplace add https://github.com/wei292224644/agent-plugin-agent
codex plugin add baton@agent-plugin-agent
```

#### 交互式安装

在 `codex` 交互界面中输入：

```text
/plugins
```

搜索 `baton`，然后选择 `Install Plugin`。

#### 本地克隆安装

在克隆好的 `agent-plugin-agent` 目录下执行：

```bash
codex plugin marketplace add .
codex plugin add baton@agent-plugin-agent
```

---

### Codex App

适用于 Codex 桌面客户端：

1. 打开 Codex App，点击左侧边栏的 **Plugins**。
2. 搜索 `Baton`（或点击添加自定义市场源：`https://github.com/wei292224644/agent-plugin-agent`）。
3. 点击 **Install** 确认安装。

---

### Cursor (Agent CLI 与 IDE)

#### Cursor Agent CLI 终端安装

Cursor 官方 Agent CLI 支持直接添加 Git 地址：

```bash
agent plugin marketplace add https://github.com/wei292224644/agent-plugin-agent
agent plugin install baton@agent-plugin-agent
```

或者在 Cursor Agent 聊天框中输入：

```text
/add-plugin baton
```

#### Cursor IDE (MCP 模式配置)

如果你主要使用 Cursor 编辑器窗口，可将其作为 MCP 服务器挂载：

在项目根目录 `.cursor/mcp.json`（或全局 Cursor 设置中的 MCP 配置）中添加：

```json
{
  "mcpServers": {
    "baton": {
      "command": "node",
      "args": ["<仓库绝对路径>/src/cli.ts", "mcp"]
    }
  }
}
```

---

### Gemini CLI

Gemini CLI 采用扩展（Extensions）系统。这里把 baton 装进 Gemini CLI 当宿主用；0.3.0 暂不支持把任务派给 gemini。

#### 远程安装

在终端中执行：

```bash
gemini extensions install https://github.com/wei292224644/agent-plugin-agent
```

#### 本地链接模式（推荐用于本地开发）

在克隆好的 `agent-plugin-agent` 目录下执行：

```bash
gemini extensions link .
```

#### 扩展更新

```bash
gemini extensions update baton
```

---

### 通用 MCP 客户端 (Claude Desktop / Windsurf 等)

本仓库提供标准的 MCP Stdio 协议服务，可以接入任何兼容 MCP 的客户端（例如 Claude Desktop、Windsurf、Zed、Cline、Roo Code）。

在宿主的 MCP 配置文件中添加：

```json
{
  "mcpServers": {
    "baton": {
      "command": "node",
      "args": ["<仓库绝对路径>/src/cli.ts", "mcp"]
    }
  }
}
```

---

## 验证安装

```bash
node src/cli.ts agents
```

输出示例：

```json
{"agents":[{"id":"codex","installed":true,"bin":"/opt/homebrew/bin/codex","version":"codex-cli 0.167.0"},{"id":"claude","installed":true,"bin":"/Users/user/.local/bin/claude","version":"2.1.323 (Claude Code)"},{"id":"cursor","installed":true,"bin":"/Users/user/.local/bin/cursor-agent","version":"2026.11.11-043ef28"},{"id":"agy","installed":true,"bin":"/Users/user/.local/bin/agy","version":"1.5.6"}]}
```

只有 `installed: true` 的 Agent 才可以作为派工目标。

---

## 使用方法

### 宿主内的技能

安装插件后，宿主会加载三个技能：

- [skills/setup/SKILL.md](skills/setup/SKILL.md)：`/baton:setup`，给插件目录装上 npm 依赖
- [skills/baton-rescue/SKILL.md](skills/baton-rescue/SKILL.md)：单跳派工，有界等待，转问或代答子 CLI 的问题
- [skills/baton-orchestrate/SKILL.md](skills/baton-orchestrate/SKILL.md)：多单调度，持依赖图、逐单推进、审查、返工、换家、汇总（不绑定 Speckit / OpenSpec / agent-skills）

对宿主说"把这个重构 rescue 给 Codex 做"之类的话，宿主就会用 shell 调 `baton start`，再循环 `baton wait --for 50` 直到结束。技能只依赖 shell 命令，不要求宿主有后台子 Agent。

**路由规则**：用户指定了目标就用指定的；没指定时实现与排错默认派给 `codex`，当前会话本身是 Codex 时改派 `claude`；绝不派给自己。

### 命令行

所有命令都只输出一个 JSON 对象（`tail` 除外），出错时退出码非 0。下面的 `baton` 指 `node <插件目录>/src/cli.ts`。

```bash
baton agents
baton start --target <codex|claude|cursor|agy> [--prompt <text> | stdin] [--file <p>...] [--effort low|medium|high|ultra]
            [--idle-timeout <秒>] [--max-duration <秒>] [--cwd <dir>]
baton status <id>
baton wait <id>... [--for <秒>]       # 默认 50；任一任务离开 running 就返回它，到点仍在跑就返回 running 视图
baton tail <id> [-f] [--raw]          # 人读格式的事件；-f 跟到任务停下；--raw 输出 events.jsonl 原行
baton reply <id> [--prompt <text> | stdin] [--as host|human]
baton cancel <id>
baton ls [--all]                      # 默认只列当前目录的任务，按更新时间倒序
baton prune --older <天数>            # 删除早于 N 天的非 running 任务目录
baton mcp                             # 启动 MCP 服务（stdio）
```

- `--effort` 映射到各家原生参数：Codex `-c model_reasoning_effort=...`；Claude/Agy `--effort`（`ultra` 映射为 `max`）；Cursor `--model auto[effort=...]`。
- `--idle-timeout` 默认 600：连续这么久没有任何输出字节才停掉。`--max-duration` 默认不限。两者都按单轮计时，`reply` 开新一轮时重新计时。

### 状态与存活判定

| `status` | 含义 |
|---|---|
| `running` | 还在跑，额外带 `liveness` 和 `quiet_for_s` |
| `needs_input` | 子 CLI 停下来提问，`decision` 里有 `question` 和 `options` |
| `success` | 本轮完成，带 `summary` 和本轮的 `git_changes` |
| `failed` / `timed_out` / `cancelled` | 终态，不能再 `reply` |
| `not_authenticated` / `quota_exceeded` | 对方 CLI 没登录 / 额度用尽 |
| `not_installed` | `start` 时就返回，目标不在 `PATH` 里 |

`running` 时的 `liveness`：

| `liveness` | 条件 |
|---|---|
| `active` | 60 秒内有输出 |
| `quiet` | 守护进程活着，但超过 60 秒没有输出（通常是在思考） |
| `orphaned` | 守护进程没了或心跳超过 30 秒未更新；下一次读会杀掉残留子进程并补写 `failed` |

### 停下提问与续轮 (needs_input / reply)

派工时 baton 会在 prompt 末尾附上输出约定：需要选择时用 `BATON_DECISION` 块提问，做完时用 `BATON_RESULT` 块总结。子 CLI 提问后任务进入 `needs_input`，进程正常退出。

```bash
baton reply <id> --as human --prompt "选 A"
```

- 在原会话上开下一轮。`--as human` 表示这是人说的话；主 Agent 依据用户先前指示代答时用默认的 `--as host`。
- `success` 之后也能 `reply` 追问。任务 `running` 时 `reply` 返回 `busy`。
- 每一轮的作者、输入和结果都记在 `turns/<n>.json`，事后可回看。

### MCP 工具

MCP 是同一套逻辑的薄壳，进程里不存任何任务状态，重启 MCP 不影响正在跑的任务：

| 工具 | 对应命令 |
|---|---|
| `list_agents` | `agents` |
| `delegate_task` | `start`（参数 `target_agent`、`prompt`、`files`、`reasoning_effort`、`idle_timeout_seconds`、`max_duration_seconds`、`cwd`） |
| `task_status` | `status` |
| `task_wait` | `wait`（参数 `task_ids`、`wait_seconds`，默认 50，上限 55；等待期间每 15 秒发一次进度通知） |
| `task_reply` | `reply`（参数 `task_id`、`prompt`、`as`） |
| `task_cancel` | `cancel` |
| `task_list` | `ls`（参数 `all`、`cwd`） |

---

## 任务目录 ~/.baton

根目录默认 `~/.baton`，可用 `BATON_HOME` 换位置。目录权限 `0700`，文件 `0600`（里面有 prompt 原文）。

```
~/.baton/tasks/<task_id>/
  meta.json          当前状态（原子写）
  events.jsonl       统一事件流
  turns/<n>.json     第 n 轮：作者、输入、结束状态、摘要、git_changes
  raw/<n>.stdout.log 第 n 轮子进程原始输出，不截断
  raw/<n>.stderr.log
```

任务目录不会自动清理，用 `baton prune --older <天数>` 手动清。

---

## 各平台底层调用规范

| Agent | 首次调用 | 续会话 | 说明 |
| :--- | :--- | :--- | :--- |
| **Codex** | `codex exec --json --color never --approve-for-me --skip-git-repo-check --cd <cwd> -` | `codex exec resume --json <thread_id> -` | `--approve-for-me` 已用 workspace-write 沙箱，与 `--sandbox` 互斥；`exec resume` 不接受 `--cd`、`--color` |
| **Claude Code** | `claude -p --output-format stream-json --verbose --permission-mode acceptEdits --permission-prompts none` | 追加 `--resume <session_id>` | `stream-json` 在 `-p` 下必须配 `--verbose`；hook 事件不进事件流 |
| **Cursor** | `cursor-agent --print --force --trust --output-format stream-json --workspace <cwd>` | 追加 `--resume <session_id>` | 优先找 `cursor-agent`，再找 `agent`，不调用 IDE 的 `cursor` |
| **Antigravity (agy)** | `agy --print <prompt> --mode accept-edits --output-format stream-json` | 追加 `--conversation <id>` | 回复是逐字增量，完整文本取自最终 `result` |

解析器认不出的输出行一律记为 `raw` 事件，不会丢。各家的真实输出样本在 `test/fixtures/`。

---

## 安全机制

1. **防递归 (`BATON_DELEGATION=1`)**：子进程环境里带这个变量，下游再调用 baton 会被直接拒绝。
2. **进程组隔离**：子 CLI 独立成进程组，超时和 `cancel` 会杀掉整组，包括它拉起的孙进程。
3. **凭据脱敏**：写进事件和摘要的文本先脱敏再截断；原始日志完整保留在受 `0600` 保护的 `raw/` 下。
4. **id 校验**：所有传入的 task id 先校验是 UUID，再拼路径。

---

## 手工冒烟测试

在一个独立的临时 Git 仓库里跑：

1. `baton agents`，确认目标 `installed: true`。
2. 发起一个会停下提问的任务：
   ```bash
   baton start --target codex --effort low --prompt "不要改文件。先停下来问我：选 A 还是 B，用 BATON_DECISION 格式，options: A | B。"
   ```
3. 另开一个终端 `baton tail -f <id>`，能实时看到事件。
4. `baton wait <id> --for 50` 直到返回 `needs_input`，`decision` 里是 A/B。
5. `baton reply <id> --as human --prompt "A。回复你选的字母后用 BATON_RESULT 结束。"`，再 `wait` 到 `success`，确认 `session_id` 与第一轮相同。

---

## 开发与单元测试

```bash
npm test          # tsc --noEmit + node --test，不消耗真实模型额度
npm run typecheck
```

集成测试用 `test/fake-cli/` 里的假 CLI 和临时 `BATON_HOME`，覆盖：父进程被杀后任务照常完成、空闲与总时长超时、取消杀整组、守护进程死亡后的孤儿判定、needs_input → reply 续会话、有界 wait、tail、ls/prune、MCP 重启后仍能读到任务。适配器测试用各家真实输出样本。

---

## 从 0.2.x 升级

- **Node 最低 24**，源码改为 TypeScript，直接运行 `src/cli.ts`。
- 入口从 `src/cli.mjs` 改为 `src/cli.ts`；手工配置的 MCP 要同步修改。
- CLI 去掉 `delegate`，改为 `start` + `wait` + `reply`；`wait` 用位置参数传 id。
- MCP 去掉 `delegate_task(session_id)` 续派和 `task_wait_any`：续轮用 `task_reply`，多单等待用 `task_wait(task_ids)`。
- `needs_decision` 改名 `needs_input`；`timeout_seconds`（上限 1800）改为 `idle_timeout_seconds` + `max_duration_seconds`，默认没有总时长上限。
- 任务状态从系统临时目录移到 `~/.baton`。
- **暂不支持 gemini 作为派工目标**（本机鉴权问题，无法验证）。Gemini CLI 作为宿主安装 baton 扩展不受影响。

---

曾用名：**Agent-Plugin-Agent (APA)**。旧安装串 `apa@apa` 已失效，请使用 `baton@agent-plugin-agent`。
