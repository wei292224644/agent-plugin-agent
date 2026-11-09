# Baton Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把产品从 APA / `apa@apa` 整包改名为 Baton / `baton@agent-plugin-agent`，运行时防递归环境变量改为 `BATON_DELEGATION`，版本升到 `0.2.0`。

**Architecture:** 纯品牌与标识符重命名，不改 MCP 工具契约与子 Agent 输出协议标记（`APA_DECISION` / `APA_RESULT` / `APA_END` 仍为线协议）。先改 runtime + 测试，再改 package/CLI，再改各端插件清单，最后改 skill 与文档，并以全仓 grep 验收。

**Tech Stack:** Node.js ESM、`node --test`、MCP stdio、各平台 plugin/marketplace JSON。

## Global Constraints

- 显示名：`Baton`；插件 / package / MCP server / CLI bin id：`baton`
- marketplace `name`：`agent-plugin-agent`；`owner.name`：`wei292224644`
- 安装串：`baton@agent-plugin-agent`；marketplace add：`wei292224644/agent-plugin-agent`
- 防递归：`BATON_DELEGATION=1`（不做 `APA_DELEGATION` 别名）
- 工作区覆盖 env：`APA_CWD` → `BATON_CWD`
- 版本：所有清单与 `package.json` / MCP server version → `0.2.0`
- **保留**线协议标记：`APA_DECISION`、`APA_RESULT`、`APA_END`（派工协议不动）
- **保留** MCP 工具名：`delegate_task`、`list_agents`（及现有 `task_status` / `task_cancel`）
- **保留** GitHub 仓库名：`agent-plugin-agent`
- 一句话描述可沿用现有中文描述，显示名处写 Baton

## File Map

| 文件 | 职责 |
|------|------|
| `src/runner.mjs` | `BATON_DELEGATION` / `BATON_CWD` / lock 前缀 `baton-` |
| `src/mcp.mjs` | MCP server `name`/`version` |
| `src/cli.mjs` | usage 里的 CLI 名 |
| `src/adapters/codex.mjs` | 临时文件前缀 `baton-codex-` |
| `package.json` / `package-lock.json` | name、bin、version |
| `test/apa.test.mjs` → `test/baton.test.mjs` | 断言新符号；保留协议标记断言 |
| 各 `plugin.json` / `marketplace.json` / `*mcp*.json` / `gemini-extension.json` | 插件与 MCP 入口 id |
| `skills/apa-rescue/` → `skills/baton-rescue/` | Host skill |
| `README.md` / `README.zh-CN.md` | 安装与品牌文案 |
| `docs/Agent-Plugin-Agent设计方案.md` | 标题改为 Baton，注明曾用名 |

---

### Task 1: Runtime 标识 — `BATON_DELEGATION` / `BATON_CWD` / lock 前缀

**Files:**
- Modify: `test/apa.test.mjs`（本 task 末尾再 rename 文件）
- Modify: `src/runner.mjs`
- Modify: `src/adapters/codex.mjs`
- Test: `test/apa.test.mjs` → 随后 `test/baton.test.mjs`

**Interfaces:**
- Consumes: 现有 `delegate({ env, ... })`
- Produces: 子进程 env 注入 `BATON_DELEGATION: "1"`；读取 `env.BATON_DELEGATION` / `env.BATON_CWD`；lock 路径 `baton-<hash>.lock`

- [ ] **Step 1: 改测试中的防递归 env（先红）**

在 `test/apa.test.mjs` 把：

```js
env: { ...process.env, APA_DELEGATION: "1" },
```

改为：

```js
env: { ...process.env, BATON_DELEGATION: "1" },
```

临时目录前缀 `"apa-bin-"` / `"apa-work-"` / `"apa-live-"` 改为 `"baton-bin-"` / `"baton-work-"` / `"baton-live-"`（纯测试夹具，不影响协议）。

**不要**改测试里对 `APA_DECISION` / `APA_RESULT` / `APA_END` 的断言与样例字符串。

- [ ] **Step 2: 跑测试确认防递归相关失败或旧符号仍绿但意图已偏**

Run: `node --test test/apa.test.mjs`

Expected: 防递归用例在 runner 仍读 `APA_DELEGATION` 时，`BATON_DELEGATION=1` **不会**拦截，该断言 `blocked.status === "failed"` **FAIL**（或不再 blocked）。若整文件因其它原因失败，先只关注这一条。

- [ ] **Step 3: 改 `src/runner.mjs`**

替换：

```js
if (env.APA_DELEGATION === "1") {
  return pack({ status: "failed", summary: "APA_DELEGATION=1，拒绝再次派工。" });
}
```

为：

```js
if (env.BATON_DELEGATION === "1") {
  return pack({ status: "failed", summary: "BATON_DELEGATION=1，拒绝再次派工。" });
}
```

替换注入：

```js
{ ...spec, cwd, env: { ...env, APA_DELEGATION: "1" } },
```

为：

```js
{ ...spec, cwd, env: { ...env, BATON_DELEGATION: "1" } },
```

两处 `env.APA_CWD` 改为 `env.BATON_CWD`。

`lockFile` 中：

```js
return path.join(os.tmpdir(), `apa-${hash}.lock`);
```

改为：

```js
return path.join(os.tmpdir(), `baton-${hash}.lock`);
```

**保留** `OUTPUT_CONTRACT` 与 `interpret` 里的 `APA_DECISION` / `APA_RESULT` / `APA_END`。

- [ ] **Step 4: 改 `src/adapters/codex.mjs` 临时文件前缀**

```js
const lastMessagePath = path.join(os.tmpdir(), `apa-codex-${process.pid}-${Date.now()}.txt`);
```

改为：

```js
const lastMessagePath = path.join(os.tmpdir(), `baton-codex-${process.pid}-${Date.now()}.txt`);
```

- [ ] **Step 5: 跑测试确认通过**

Run: `node --test test/apa.test.mjs`

Expected: 全部 PASS

- [ ] **Step 6: 重命名测试文件并再跑**

```bash
git mv test/apa.test.mjs test/baton.test.mjs
node --test test/baton.test.mjs
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/runner.mjs src/adapters/codex.mjs test/baton.test.mjs
git commit -m "$(cat <<'EOF'
refactor: 运行时标识改用 BATON_DELEGATION

防递归与工作区 env、锁文件前缀随品牌改名；线协议标记保持不变。
EOF
)"
```

---

### Task 2: Package / CLI / MCP server 身份与版本

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/cli.mjs`
- Modify: `src/mcp.mjs`
- Test: `test/baton.test.mjs`（回归）

**Interfaces:**
- Consumes: Task 1 的 runner 行为
- Produces: bin 名 `baton`；MCP server `{ name: "baton", version: "0.2.0" }`

- [ ] **Step 1: 更新 `package.json`**

将内容改为（依赖版本保持原值）：

```json
{
  "name": "baton",
  "version": "0.2.0",
  "private": true,
  "type": "module",
  "bin": {
    "baton": "src/cli.mjs"
  },
  "scripts": {
    "start": "node src/cli.mjs",
    "test": "node --test"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.20.2"
  }
}
```

- [ ] **Step 2: 同步 `package-lock.json` 顶层 name/version**

把 lock 文件里根包 `"name": "apa"` 改为 `"baton"`，`"version": "0.1.0"` 改为 `"0.2.0"`，以及 `packages[""]` 内对应字段与 `bin.apa` → `bin.baton`。不要手改依赖树哈希；若不确定，可在仓库根执行：

```bash
npm install --package-lock-only
```

Expected: lock 与 `package.json` 一致且无意外依赖升级（允许仅 name/bin/version 变化）。

- [ ] **Step 3: 改 `src/cli.mjs` usage**

```js
const usage = `用法:
  baton agents
  baton delegate --target <codex|claude|gemini|agy|cursor> [--prompt <text>] [--session <id>] [--timeout <seconds>] [--file <path>...]
  baton status [--task <id>]
  baton cancel [--task <id>]
  baton mcp

没有 --prompt 时从 stdin 读取任务。
`;
```

- [ ] **Step 4: 改 `src/mcp.mjs`**

```js
const server = new McpServer({ name: "baton", version: "0.2.0" });
```

- [ ] **Step 5: 回归测试**

Run: `npm test`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/cli.mjs src/mcp.mjs
git commit -m "$(cat <<'EOF'
chore: 将 package/CLI/MCP 身份改为 baton@0.2.0

对外入口与版本对齐 Baton 品牌。
EOF
)"
```

---

### Task 3: 各端插件与 MCP 配置清单

**Files:**
- Modify: `plugin.json`
- Modify: `.cursor-plugin/plugin.json`
- Modify: `.codex-plugin/plugin.json`
- Modify: `.claude-plugin/plugin.json`
- Modify: `.claude-plugin/marketplace.json`
- Modify: `.agents/plugins/marketplace.json`
- Modify: `.mcp.json`
- Modify: `.cursor-mcp.json`
- Modify: `.codex-mcp.json`
- Modify: `mcp_config.json`
- Modify: `gemini-extension.json`

**Interfaces:**
- Consumes: CLI 入口仍为 `src/cli.mjs mcp`
- Produces: 所有清单中插件/MCP key 为 `baton`；marketplace 名为 `agent-plugin-agent`

- [ ] **Step 1: 根与各端 `plugin.json`**

`plugin.json`：

```json
{
  "name": "baton",
  "displayName": "Baton",
  "version": "0.2.0",
  "description": "把一块有边界的工作下放到另一家本地 Agent CLI，需要决定时用同一会话继续。"
}
```

`.cursor-plugin/plugin.json`：在现有字段基础上把 `name`→`baton`，`displayName`→`Baton`，`version`→`0.2.0`；保留 `skills` / `mcpServers` 路径。

`.codex-plugin/plugin.json`：`name`→`baton`，`interface.displayName`→`Baton`，`version`→`0.2.0`；保留 `skills` / `mcpServers`。

`.claude-plugin/plugin.json`：`name`→`baton`，`version`→`0.2.0`（若无 displayName 则不加）。

- [ ] **Step 2: marketplace 文件**

`.claude-plugin/marketplace.json`：

```json
{
  "name": "agent-plugin-agent",
  "owner": {
    "name": "wei292224644"
  },
  "metadata": {
    "description": "Baton：当前 CLI 做宿主，另一家本地 CLI 做执行。",
    "version": "0.2.0"
  },
  "plugins": [
    {
      "name": "baton",
      "description": "把一块有边界的工作下放到另一家本地 Agent CLI，需要决定时用同一会话继续。",
      "version": "0.2.0",
      "source": "./"
    }
  ]
}
```

`.agents/plugins/marketplace.json`：顶层 `name`→`agent-plugin-agent`，`interface.displayName`→`Baton`，插件条目 `name`→`baton`，`version`→`0.2.0`；其余 `source`/`policy`/`category` 保持。

- [ ] **Step 3: MCP 配置中的 server key**

对以下文件，把 `mcpServers.apa` 键改为 `mcpServers.baton`（command/args/cwd 不变）：

- `.mcp.json`
- `.cursor-mcp.json`
- `.codex-mcp.json`
- `mcp_config.json`
- `gemini-extension.json`（同时顶层 `name`→`baton`，`version`→`0.2.0`）

示例（`.mcp.json`）：

```json
{
  "mcpServers": {
    "baton": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/src/cli.mjs", "mcp"]
    }
  }
}
```

- [ ] **Step 4: 静态检查**

Run:

```bash
node -e "for (const f of ['plugin.json','.cursor-plugin/plugin.json','.codex-plugin/plugin.json','.claude-plugin/plugin.json','.claude-plugin/marketplace.json','.agents/plugins/marketplace.json','.mcp.json','.cursor-mcp.json','.codex-mcp.json','mcp_config.json','gemini-extension.json']) JSON.parse(require('fs').readFileSync(f,'utf8')); console.log('ok')"
```

Expected: 打印 `ok`

- [ ] **Step 5: Commit**

```bash
git add plugin.json .cursor-plugin/plugin.json .codex-plugin/plugin.json .claude-plugin/plugin.json .claude-plugin/marketplace.json .agents/plugins/marketplace.json .mcp.json .cursor-mcp.json .codex-mcp.json mcp_config.json gemini-extension.json
git commit -m "$(cat <<'EOF'
chore: 插件与 MCP 清单改为 baton@agent-plugin-agent

对齐各端安装 id 与 marketplace 名。
EOF
)"
```

---

### Task 4: Skill 改名为 `baton-rescue`

**Files:**
- Rename: `skills/apa-rescue/` → `skills/baton-rescue/`
- Modify: `skills/baton-rescue/SKILL.md`

**Interfaces:**
- Consumes: MCP 工具仍为 `delegate_task`
- Produces: skill `name: baton-rescue`；正文称 Baton / baton MCP

- [ ] **Step 1: 移动目录**

```bash
git mv skills/apa-rescue skills/baton-rescue
```

- [ ] **Step 2: 重写 `skills/baton-rescue/SKILL.md`**

```markdown
---
name: baton-rescue
description: Hands a bounded coding task to another local agent CLI through the baton MCP tool delegate_task. Use proactively when implementation, debugging, or a second pass should run in another agent environment, when the user says rescue or asks to hand work to Codex, Claude, Agy, or Cursor, and when a previous delegate_task returned needs_decision for the same session.
---

# Baton Rescue

把一块有边界的工作下放到另一家本地 CLI。调用 MCP 工具 `delegate_task`。不要自己拼 shell，也不要自己把这块做完。

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

## 返回之后

- `success`：把 `summary` 和 `git_changes` 告诉用户。不要在当前会话里重做这些修改。
- `needs_decision`：把 `question` 和 `options` 原样问用户。等回答。再用同一个 `session_id` 调用 `delegate_task`，`prompt` 只写用户的选择。不要替用户选，也不要新开一轮。
- `failed`、`timed_out`、`not_installed`、`not_authenticated`、`busy`：转告 `summary`，然后停下。不要在当前会话里把活做掉。
```

若当前 SKILL 还描述了 `running` / `task_status` / `task_cancel`，保留那些段落，仅把 APA/apa 换成 Baton/baton。

- [ ] **Step 3: Commit**

```bash
git add skills/baton-rescue skills/apa-rescue
git commit -m "$(cat <<'EOF'
refactor: 将 apa-rescue skill 重命名为 baton-rescue

Host 侧下放技能随品牌改名。
EOF
)"
```

---

### Task 5: README 与架构文档

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `docs/Agent-Plugin-Agent设计方案.md`（可 `git mv` 为 `docs/Baton设计方案.md`）

**Interfaces:**
- Consumes: 安装串与 id 来自 Task 3
- Produces: 用户文档全部指向 Baton / `baton@agent-plugin-agent`

- [ ] **Step 1: 更新 `README.md` 标题与架构图**

- 标题：`# Baton`（可副标题保留 “local peer bridge”；曾用名 APA 如需仅在一文末脚注一句）
- 图中 `APA (Local Peer Bridge / MCP)` → `Baton (Local Peer Bridge / MCP)`
- `APA_DELEGATION=1` → `BATON_DELEGATION=1`
- 所有 `apa@apa` → `baton@agent-plugin-agent`
- 搜索安装处的 `` `apa` `` → `` `baton` ``
- MCP JSON 示例键 `"apa"` → `"baton"`
- skill 路径 `skills/apa-rescue/SKILL.md` → `skills/baton-rescue/SKILL.md`
- CLI 示例若写 `apa ...` → `baton ...`
- Safety 章节文案中的 APA → Baton；**保留**对 `APA_DECISION` / `APA_RESULT` / `APA_END` 的协议说明（若有）

marketplace add 保持：

```text
wei292224644/agent-plugin-agent
```

或完整 URL 形式与现文档风格一致。

- [ ] **Step 2: 对 `README.zh-CN.md` 做同样替换**

中文标题：`# Baton`；描述与安装示例与英文版对齐。

- [ ] **Step 3: 更新架构设计文档**

```bash
git mv "docs/Agent-Plugin-Agent设计方案.md" "docs/Baton设计方案.md"
```

文首改为：

```markdown
# Baton 架构设计方案
> **基于 MCP 的去中心化多 Agent 算力分发与协同体系**  
> *曾用名：Agent-Plugin-Agent (APA)*  
> *创建时间：2026-11-06；品牌更名：2026-11-09*
```

正文里作为产品名的 APA / Agent-Plugin-Agent 改为 Baton；协议标记段落若出现 `APA_DECISION` 等则保留。

- [ ] **Step 4: Commit**

```bash
git add README.md README.zh-CN.md docs/Baton设计方案.md "docs/Agent-Plugin-Agent设计方案.md"
git commit -m "$(cat <<'EOF'
docs: 将用户文档与设计方案切换到 Baton

安装串改为 baton@agent-plugin-agent，并注明曾用名 APA。
EOF
)"
```

---

### Task 6: 残留扫描与最终验收

**Files:**
- 全仓只读扫描；仅修复漏网的产品名/插件 id（不改协议标记）

- [ ] **Step 1: Grep 产品 id**

Run:

```bash
rg -n --glob '!docs/superpowers/**' --glob '!package-lock.json' \
  -e '\\bAPA_DELEGATION\\b' -e '\\bAPA_CWD\\b' -e 'apa@apa' -e 'skills/apa-rescue' \
  -e '"name": "apa"' -e 'displayName": "APA"' -e '`apa`' \
  -e 'bin\\.apa|\"apa\": \"src/cli'
```

Expected: 无匹配（协议标记 `APA_DECISION` 等不在此列表中）

- [ ] **Step 2: 允许残留的协议标记抽查**

Run:

```bash
rg -n 'APA_DECISION|APA_RESULT|APA_END' src test README.md README.zh-CN.md
```

Expected: `src/runner.mjs`、测试与文档协议章节仍有命中

- [ ] **Step 3: 最终测试**

Run: `npm test`

Expected: PASS

- [ ] **Step 4: 若 Step 1 有漏网，修完后再 commit；否则可空跳过**

```bash
git add -A
git status
# 若有变更：
git commit -m "$(cat <<'EOF'
chore: 清理 Baton 改名残留引用

扫掉仍指向 apa/APA 产品 id 的配置与文案。
EOF
)"
```

---

## Self-Review

1. **Spec coverage:** 显示名/id/marketplace/安装串/`BATON_DELEGATION`/skill/版本 0.2.0/无 apa 别名/保留工具名与仓库名 — 均有对应 Task；线协议保留写在 Global Constraints 与 Task 1/5/6。
2. **Placeholders:** 无 TBD；关键 JSON/代码块为完整替换内容。
3. **Consistency:** 全程 `baton` + `agent-plugin-agent` + `0.2.0` + `BATON_DELEGATION` / `BATON_CWD`。
