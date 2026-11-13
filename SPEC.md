# Spec: Baton 核心重构——脱离 MCP 进程的长任务与可观测派工

日期：2026-11-13
状态：已审定，待拆计划

## Objective

Baton 让任意一个 agent CLI（宿主）把有边界的工作派给本机其他 agent CLI（worker），目的是分摊算力。现有实现把任务状态放在 MCP 进程内存里（`src/runner.mjs` 的 `tasks` Map），带来三个硬伤：

1. MCP 进程一退，任务成孤儿；CLI 侧的 `baton wait` 也接不上 MCP 发起的任务。
2. 总时长硬上限 1800s，超时即杀，慢 CLI 跑不完长任务。
3. `task_wait` 长阻塞撞宿主的工具调用超时，只能靠"开后台子 Agent"绕路，这只在部分宿主可行；子进程过程对宿主和人都不可见（claude 适配器用 `--output-format json`，结束前没有任何输出）。

本次重构把核心改成 **CLI + 磁盘状态 + 脱离父进程的守护进程**，MCP 降为同一份状态之上的薄壳。

### 目标与对应设计

| # | 目标 | 本 spec 的回答 |
|---|---|---|
| 1 | 唤醒其他 CLI 执行并返回中间问题或最终结果 | `baton start` / `reply`，结果和决策写入任务目录 |
| 2 | 长时间运行 | 守护进程独立于宿主存活；默认只有空闲超时，没有总时长上限 |
| 3 | 主 AI 增强子 CLI 能力 | **不在本次范围**，`reply` 已提供注入思路的通道 |
| 4 | 实时看子 CLI 状态和对话 | 统一事件流 `events.jsonl` + `baton tail -f` + 存活判定 |
| 5 | 代理充当用户解决问题，对话可观测 | 按轮交互：一轮结束即中断点，`reply` 续原 session，每轮输入输出和作者落盘 |
| 6 | 无缝接入任何 CLI 体系，保持中立 | 核心接口是 shell 命令；MCP 和 skills 只是可选入口，不依赖任何宿主特有能力 |

### 用户故事

- 作为宿主 Agent，我 `baton start` 一个任务后立刻拿到 `task_id`，之后用有界的 `baton wait --for 50` 反复等，不会撞上任何工具超时。
- 作为人，我在另一个终端 `baton tail -f <id>`，能看到子 CLI 正在调哪个工具、说了什么；`baton status` 告诉我它是在动、空闲还是已经死了。
- 作为宿主 Agent，子 CLI 停在 `needs_input` 时，我（或我转问人之后）用 `baton reply <id>` 回答，它在原 session 上继续；事后能回看每一轮是谁说的。
- 宿主会话退出、MCP 重启后，任务照常跑完，结果仍可通过 `baton status` 读到。

### 非目标

- 一轮中途向子 CLI 插话（需要 PTY 驱动各家 TUI，脆弱，不做）。
- 网页或 TUI 面板。
- 为 superpowers、OpenSpec 等工作流做专门适配。
- 子 CLI 的权限弹窗交互式应答（沿用各适配器预设的审批模式）。
- 任务目录自动清理（只提供手动的 `baton prune`）。

## Tech Stack

- 语言：TypeScript，直接用 Node 原生类型剥离运行 `.ts`，**不加构建步骤**。已实测 Node `v24.22.2` 下 `node x.ts` 无 flag、无警告。
- 只用可擦除语法：不用 `enum`、`namespace`、构造函数参数属性、`import =`。tsconfig 开 `erasableSyntaxOnly`、`verbatimModuleSyntax`。
- 运行时依赖：仍只有 `@modelcontextprotocol/sdk`（含 `zod`）。
- 新增开发依赖：`typescript`、`@types/node`，只用于 `tsc --noEmit`。
- 最低 Node 版本：24，写进 `package.json` 的 `engines`（`"node": ">=24"`）。
- 分发方式不变：插件仓库直接安装；`mcp_config.json` 和 `gemini-extension.json` 的入口改成 `src/cli.ts`。

## 架构

```
宿主 CLI ──shell──> baton start ──spawn detached──> baton _supervise <id>
   │                    │ (立即返回 task_id)              │ 持有子 CLI 进程组
   │                    ▼                                 │ 解析流式输出 → 事件
   │            ~/.baton/tasks/<id>/  <──── 唯一写者 ─────┘
   │                    ▲
   └──shell/MCP──> baton status / wait / tail / reply / cancel / ls（只读，cancel 发信号）
```

### 任务目录

根目录 `~/.baton`，可用 `BATON_HOME` 覆盖（测试必需）。目录权限 `0700`，文件 `0600`（目录中存有 prompt 原文）。

```
~/.baton/tasks/<task_id>/
  meta.json          当前状态，原子写（写临时文件再 rename）
  events.jsonl       统一事件流，追加写
  turns/<n>.json     第 n 轮：作者、输入 prompt、结束状态、摘要、git_changes
  raw/<n>.stdout.log 第 n 轮子进程原始 stdout，不截断
  raw/<n>.stderr.log
```

- `task_id` 为 UUID；所有读入的 id 先校验格式再拼路径，防止目录穿越。
- 每个任务同一时刻只有一个写者：当前轮的 supervisor。读命令不写文件，只有两种例外：`cancel`，以及发现孤儿时补写终态（见"存活判定"）。

### meta.json

```ts
type TaskMeta = {
  task_id: string;
  target: "codex" | "claude" | "gemini" | "agy" | "cursor";
  cwd: string;
  created_at: string;          // ISO 8601
  updated_at: string;
  status: TaskStatus;
  turn: number;                // 当前或最近一轮，从 1 开始
  session_id: string | null;   // 子 CLI 的会话 id，reply 用
  model?: string;              // 创建时选择的模型，每轮沿用
  reasoning_effort?: "low" | "medium" | "high" | "ultra";
  idle_timeout_s: number;
  max_duration_s: number | null;
  supervisor_pid: number | null;
  child_pid: number | null;    // 子进程组 leader
  heartbeat_at: string | null; // supervisor 每 10s 更新一次
  last_event_at: string | null;
  decision?: { question: string; options: string[] };
  summary?: string;
  warning?: string;
};
```

### 状态机

```
start ──> running ──┬──> needs_input ──reply──> running
                    ├──> success ──────reply──> running   （允许追问）
                    ├──> failed | timed_out | cancelled
                    │    | not_authenticated | quota_exceeded（终态，不可 reply）
not_installed（start 时即返回，不建守护进程）
```

- `running` 时 `reply` 被拒绝，返回 `status: "busy"`。
- 一轮结束时：输出里有 `BATON_DECISION` 记 `needs_input` 并填 `decision`；有 `BATON_RESULT` 或正常退出记 `success`；其余按现有失败判定（鉴权、额度、退出码）。沿用现有的 `OUTPUT_CONTRACT` 标记协议。

### 存活判定（回答"在跑还是卡住"）

`status` 和 `ls` 对 `running` 任务额外给出 `liveness`：

| liveness | 条件 |
|---|---|
| `active` | supervisor 存活，`last_event_at` 在 60s 内 |
| `quiet` | supervisor 存活，60s 以上没有事件，但未到 `idle_timeout_s` |
| `orphaned` | `supervisor_pid` 不存在，或 `heartbeat_at` 超过 30s 未更新 |

返回体同时带 `quiet_for_s`（距上一个事件的秒数）。

读命令遇到 `orphaned` 时：如果 `child_pid` 进程组还活着就先杀掉，再把任务补写成 `failed`，`summary` 为 `"supervisor 意外退出"`。

shortcut：存活检测只用 `kill(pid, 0)` 加心跳，PID 复用理论上可能误判；需要更严时再加进程启动时间校验。

### 超时

- `idle_timeout_s`：默认 600。子进程 stdout/stderr 连续这么久没有任何字节就杀掉，记 `timed_out`，`summary` 注明 `idle`。
- `max_duration_s`：默认 `null`（不限），可按单设置；超了记 `timed_out`，`summary` 注明 `max_duration`。
- 两者对单轮计时，`reply` 开新一轮时重新计时。

### 事件 schema

每行一个 JSON：

```ts
type BatonEvent = { ts: string; turn: number } & (
  | { type: "turn_started"; author: "host" | "human"; prompt_preview: string }
  | { type: "message"; text: string }                        // 子 CLI 的助手文本
  | { type: "tool_call"; name: string; detail: string }      // detail 截断到 200 字符
  | { type: "tool_result"; name: string; ok: boolean; detail: string }
  | { type: "raw"; stream: "stdout" | "stderr"; line: string }   // 无法解析的行
  | { type: "error"; text: string }
  | { type: "turn_ended"; status: TaskStatus; exit_code: number | null }
);
```

`raw` 只在适配器解析失败时出现，保证没有输出被静默丢弃。

### 适配器

每家一个模块，接口：

```ts
type Adapter = {
  id: Target;
  resolve(env: NodeJS.ProcessEnv): string | null;
  build(input: { bin: string; cwd: string; prompt: string; sessionId: string | null;
                 model?: string; reasoningEffort: Effort | null }): SpawnSpec;
  parseLine(line: string): BatonEvent[] | null;   // null 表示不认识，记为 raw
  sessionIdFrom(line: string): string | null;
  isAuthFailure(text: string): boolean;
};
```

流式参数（已对照本机 `--help` 核实参数存在，事件格式待用真实输出录 fixture 确认）：

| target | 流式输出 | 续会话 |
|---|---|---|
| claude | `-p --output-format stream-json --verbose` | `--resume <id>` |
| codex | `exec --json`（现状） | `exec resume <id>` |
| gemini | `-p … -o stream-json` | `--resume <uuid>`（源码核实接受完整 UUID；会话按项目目录存储，续会话 cwd 必须一致） |
| cursor | `--print --output-format stream-json` | `--resume <id>` |
| agy | `--print … --output-format stream-json` | `--conversation <id>` |

现有的思考档位映射（Issue #29）、审批模式参数、`BATON_DELEGATION=1` 防递归保持不变。

## Commands（CLI 命令面）

所有命令的 stdout 只输出一个 JSON 对象（`tail` 除外），错误时退出码非 0。

```
baton agents
baton start --target <t> [--prompt <text> | stdin] [--file <p>...] [--model <name>] [--effort <e>]
            [--idle-timeout <s>] [--max-duration <s>] [--cwd <dir>]
baton status <id>
baton wait <id>... [--for <s>]     # 默认 50s；任一任务离开 running 即返回该任务，到点仍在跑就返回 running 视图
baton tail <id> [-f] [--raw]       # 人读格式；--raw 输出 events.jsonl 原行
baton reply <id> [--prompt <text> | stdin] [--as host|human]   # 默认 --as host
baton cancel <id>
baton ls [--all]                   # 默认只列当前 cwd 的任务，按更新时间倒序
baton prune --older <天数>         # 删除更新时间早于 N 天的非 running 任务目录，返回删除清单
baton mcp
```

- 内部命令 `baton _supervise <id>` 不写进帮助文本。
- 移除旧的 `delegate` 子命令；`wait` 合并了旧的单任务等待和 `wait_any`。
- `start` / MCP `delegate_task` 接收可选 `model`，与 `reasoning_effort` 一起写入 meta；`reply` 每轮沿用。未指定模型时不覆盖 CLI 默认值，空模型名拒绝。
- Cursor 同时指定模型和档位时从 `cursor-agent models` 中选择同一家族的档位变体（保留 fast，ultra 优先 max、其次 xhigh/extra-high），不支持时失败；effort 不能与 Auto 搭配。仅指定模型时原样传递。此规则避免本机帮助宣传但实际被拒绝的部分括号覆盖语法。

开发命令：

```
npm test          # = tsc --noEmit && node --test "test/**/*.test.ts"
npm run typecheck # = tsc --noEmit
```

### MCP 工具（薄壳，与 CLI 一一对应）

`list_agents`、`delegate_task`（等于 start）、`task_status`、`task_wait`（`task_ids` 数组加 `wait_seconds`，默认 50，上限 55）、`task_reply`、`task_cancel`、`task_list`。

不再要求宿主开后台子 Agent。`task_wait` 不再长阻塞，所以不会撞工具超时。保留进度通知。

这是破坏性变更：移除 `session_id` 续派（改用 `task_reply`）和 `task_wait_any`。版本升到 `0.3.0`。

### Skills

`baton-rescue`、`baton-orchestrate` 改写为 shell 优先：用 `baton start`，然后循环 `baton wait --for 50`；`needs_input` 时转问或代答，再 `baton reply`。

只把宿主特有能力写成可选提示，例如"宿主能后台跑 shell 时，可以一次 `wait --for` 更久"，不作为前提。

## Project Structure

```
src/
  cli.ts          命令解析与分发
  store.ts        BATON_HOME、任务目录、meta 原子读写、事件追加、id 校验
  supervisor.ts   _supervise：拉起子进程组、心跳、超时、解析、收尾
  tasks.ts        start / status / wait / reply / cancel / ls 的实现（读侧 + 存活判定）
  contract.ts     OUTPUT_CONTRACT、buildPrompt、interpret（从 runner.mjs 迁出）
  git.ts          迁自 git.mjs，逻辑不变
  mcp.ts          MCP 薄壳
  types.ts        TaskMeta、TaskStatus、BatonEvent、Adapter
  adapters/<t>.ts、adapters/common.ts、adapters/index.ts
test/
  *.test.ts
  fixtures/<target>.stream.jsonl   各家真实流式输出样本
  fake-cli/                        测试用假 CLI 脚本
skills/   docs/   scripts/        （不变，内容随本次更新）
```

`runner.mjs` 及其他 `.mjs` 删除；`scripts/setup.mjs` 视实现时的情况决定是否一并迁移。

## Code Style

沿用现有风格：ESM、双引号、两空格缩进、小函数、注释只写"为什么"、面向用户的文案用中文。示例：

```ts
export function readMeta(id: string): TaskMeta | null {
  const dir = taskDir(id); // taskDir 内校验 UUID，非法 id 抛错
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf8")) as TaskMeta;
  } catch {
    return null; // 目录不存在或正被 rename，调用方按"未知任务"处理
  }
}
```

## Testing Strategy

- 框架：`node:test` + `node:assert/strict`，测试文件写成 `.ts`。
- **单元测试**：
  - 每个适配器的 `parseLine` 喂 `test/fixtures/<target>.stream.jsonl`，断言事件序列；
  - `interpret` 标记解析；
  - 状态机迁移；
  - id 校验拒绝 `../`。
- **集成测试**：用 `test/fake-cli/` 里的假 CLI 脚本，在临时 `BATON_HOME` 中跑真实的 start/supervise。必须覆盖：
  1. 发起 `start` 的父进程退出后，任务仍跑完并写出 `success`；
  2. 空闲超时杀进程并记 `timed_out`；
  3. `cancel` 杀掉整个进程组；
  4. `needs_input` 后 `reply` 带上正确的 session 续会话，`turns/` 记录作者；
  5. kill 掉 supervisor 后，`status` 报 `orphaned` 并补写终态；
  6. `wait --for 1` 在任务未完成时按时返回 `running`；
  7. `running` 时 `reply` 返回 `busy`；
  8. `prune` 只删早于阈值的非 `running` 任务。
- **手工 e2e**：五家真实 CLI 各跑一单简单任务和一单 `reply`，结果记进 PR 描述。fixture 也从这一步录制。
- 覆盖率：按项目约定 80%；fake-cli 驱动的集成测试计入覆盖率。

## Boundaries

- **Always**：提交前跑 `npm test`；读入的 task id 先校验；任务目录 `0700`；子进程用独立进程组，cancel 和超时杀整组；保留 `BATON_DELEGATION` 防递归。
- **Ask first**：增加运行时依赖；改变 `~/.baton` 布局（落地之后）；调整默认超时数值；改各家审批模式参数。
- **Never**：把凭据或 token 写进事件或日志摘要；静默丢弃无法解析的输出；读命令修改 `running` 中的任务（孤儿补写除外）。

## Success Criteria

1. 宿主进程退出、MCP 重启后，正在跑的任务继续运行，之后 `baton status` 能读到终态。（集成测试 1）
2. 运行 2 小时、持续有输出的任务不会被 baton 杀掉。（用 `max_duration_s=null` 加有输出的假 CLI 测试，测试中缩短时间尺度）
3. 任一时刻，`baton status` 都能在 1s 内给出 `liveness` 和 `quiet_for_s`；不管是 supervisor 死掉还是子进程卡住，都能区分出来。（集成测试 2、5）
4. claude 任务运行期间，`baton tail -f` 能看到 `message` 或 `tool_call` 事件，不必等到结束。（手工 e2e）
5. 任何 `wait` 调用的返回时间不超过 `--for` 加 2s。（集成测试 6）
6. `reply` 续的是同一个子 CLI session，`turns/<n>.json` 正确记录 `author`。（集成测试 4，加五家各一次手工 e2e）
7. 只靠 shell 命令，不用 MCP，就能完成"派工—等待—答复—拿结果"的全流程；skills 不依赖任何宿主特有能力。
8. `npm test` 通过，包括 `tsc --noEmit`；仓库中不再有 `.mjs` 源文件（`scripts/` 除外，若决定不迁）。

## 已决定（2026-11-13 审阅）

1. 最低 Node 版本为 24。
2. gemini `--resume` 接受完整 UUID（依据 gemini-cli 0.67.0 源码 `SessionSelector.resolveSession`），`reply` 对 gemini 可用。
3. agy、gemini、cursor 的 stream-json 解析器要先录真实样本再写。本机 gemini 目前鉴权失败（`throwIneligibleOrProjectIdError`），它的样本需要先修好鉴权，或者换一台机器录。
4. 提供 `baton prune --older <天数>`，不做自动清理。
5. 直接移除 `delegate_task(session_id)` 和 `task_wait_any`，不保留兼容别名。
6. `idle_timeout_s` 默认 600。
7. **0.3.0 不支持 gemini 作为派工目标**（2026-11-13）。本机 gemini 鉴权失败，无法录样本和 e2e；`Target` 去掉 gemini，等鉴权可用后按 Task 13 补回。`gemini-extension.json`（把 baton 装进 gemini 宿主）不受影响。

## Open Questions

无。
