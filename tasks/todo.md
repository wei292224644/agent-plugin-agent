# Tasks: Baton 核心重构

规格：`SPEC.md`；计划：`tasks/plan.md`

## Phase 1: 基础

- [x] Task 1: TypeScript 工具链（S）
  - Acceptance:
    - `tsconfig.json` 开 `strict`、`noEmit`、`erasableSyntaxOnly`、`verbatimModuleSyntax`、`allowImportingTsExtensions`
    - `package.json`：`engines.node` 为 `">=24"`；新增 devDependencies `typescript`、`@types/node`；`npm test` = `tsc --noEmit && node --test test/*.test.mjs "test/**/*.test.ts"`；新增 `typecheck` 脚本
    - 一个 `test/smoke.test.ts` 能被 `node --test` 收集并通过
  - Verify: `npm test`（旧的 26 个测试加 smoke 全绿）
  - Files: `package.json`, `package-lock.json`, `tsconfig.json`, `test/smoke.test.ts`
  - Deps: 无

- [x] Task 2: 类型与任务存储（S）
  - Acceptance:
    - `types.ts` 定义 `TaskMeta`、`TaskStatus`、`BatonEvent`、`Adapter`、`SpawnSpec`，与 SPEC 一致
    - `store.ts` 负责：`BATON_HOME` 解析（默认 `~/.baton`）；非 UUID 的 id 抛错；`writeMeta` 原子写（临时文件加 `rename`）；`appendEvent`；`writeTurn`；`readMeta`；`listTasks`
    - 目录权限 `0700`，文件权限 `0600`
  - Verify: `node --test test/store.test.ts`，覆盖 `../x` 被拒、权限位、并发读不会读到半个文件
  - Files: `src/types.ts`, `src/store.ts`, `test/store.test.ts`
  - Deps: T1

- [x] Task 3: 迁移 contract 与 git（S）
  - Acceptance:
    - `contract.ts` 导出 `OUTPUT_CONTRACT`、`buildPrompt`、`interpret`，行为与 `runner.mjs` 一致
    - `git.ts` 导出 `gitSnapshot`、`gitChanges`，行为与 `git.mjs` 一致
    - 相关的旧测试复制成 `.ts` 版本
  - Verify: `node --test test/contract.test.ts test/git.test.ts`
  - Files: `src/contract.ts`, `src/git.ts`, `test/contract.test.ts`, `test/git.test.ts`
  - Deps: T2

- [x] Task 4: codex 适配器与 fake CLI 骨架（S）
  - Acceptance:
    - `adapters/codex.ts` 的 `build` 参数沿用现状（含 effort 映射、`resume`）
    - `parseLine` 把 `item.started`、`item.completed`、`agent_message`、`command_execution`、`file_change`、`turn.failed` 转成 `message`、`tool_call`、`tool_result`、`error` 事件；认不出的行返回 `null`
    - `sessionIdFrom` 能解析 `thread.started`
    - `adapters/common.ts` 迁入 `which`、`authHit`
    - 提供 `test/fake-cli/fake.sh`：按 `FAKE_FIXTURE`、`FAKE_SLEEP`、`FAKE_EXIT`、`FAKE_HANG` 控制行为，并以 `codex` 的名字链接进 PATH
  - Verify: `node --test test/adapters.test.ts`（喂 `test/fixtures/codex.stream.jsonl`，断言事件序列）
  - Files: `src/adapters/codex.ts`, `src/adapters/common.ts`, `src/adapters/index.ts`, `test/fixtures/codex.stream.jsonl`, `test/fake-cli/fake.sh`, `test/adapters.test.ts`
  - Deps: T2

## Checkpoint: Foundation

- [x] `npm test` 全绿，新旧测试并存
- [x] `tsc --noEmit` 无错误

## Phase 2: 核心流程（codex 打通）

- [x] Task 5: start、supervise、status（M，风险最高）
  - Acceptance:
    - `baton start --target codex --prompt …` 在 1s 内返回 `{task_id, status:"running"}`
    - supervisor 以 detached 方式运行；子进程独立成进程组；事件逐行写入 `events.jsonl`，原始输出写入 `raw/1.*.log`；每 10s 写一次心跳
    - 一轮结束时写 `turns/1.json`（含 `git_changes`）和终态；鉴权失败、额度用尽、`BATON_RESULT` 的判定沿用旧逻辑
    - **发起 `start` 的父进程被 SIGKILL 后，任务仍能跑完并写出 `success`**
    - 设置了 `BATON_DELEGATION=1` 时拒绝派工
  - Verify: `node --test test/lifecycle.test.ts`，覆盖 SPEC 集成测试 1；再在 Claude Code 的 Bash 工具里手工 `start` 一单，退出会话后检查任务是否完成
  - Files: `src/supervisor.ts`, `src/tasks.ts`, `src/cli.ts`, `test/lifecycle.test.ts`
  - Deps: T3, T4

- [x] Task 6: 存活判定、超时、取消、孤儿（M）
  - Acceptance:
    - `status` 返回 `liveness`（`active`、`quiet`、`orphaned`）和 `quiet_for_s`
    - 空闲超时和 `max_duration` 会杀整个进程组，记 `timed_out`，summary 注明原因
    - `cancel` 杀进程组，记 `cancelled`
    - supervisor 被 kill 后，`status` 报 `orphaned`，杀掉残留的子进程，并补写 `failed`
  - Verify: `node --test test/lifecycle.test.ts`，覆盖 SPEC 集成测试 2、3、5，以及成功标准 2（缩短时间尺度）
  - Files: `src/supervisor.ts`, `src/tasks.ts`, `src/cli.ts`, `test/lifecycle.test.ts`
  - Deps: T5

- [x] Task 7: 有界 wait 与 tail（S）
  - Acceptance:
    - `wait <id>... --for N` 只要有任一任务离开 `running` 就返回该任务；到点仍未结束则返回 `running` 视图，耗时不超过 N+2s
    - `tail <id>` 以人读格式输出事件；`-f` 持续跟随，任务进入终态后退出；`--raw` 输出原始行
  - Verify: `node --test test/observe.test.ts`，覆盖 SPEC 集成测试 6；手工另开一个终端 `tail -f`
  - Files: `src/tasks.ts`, `src/tail.ts`, `src/cli.ts`, `test/observe.test.ts`
  - Deps: T5

- [x] Task 8: reply 与多轮记录（M）
  - Acceptance:
    - 遇到 `BATON_DECISION` 记 `needs_input` 并填写 `decision`
    - `reply <id> --prompt … [--as human]` 用 `session_id` 开第 n+1 轮；`turns/<n>.json` 记录 `author`；超时重新计时
    - 任务处于 `running` 时 `reply` 返回 `busy`；终态失败的任务 `reply` 返回错误
  - Verify: `node --test test/lifecycle.test.ts`，覆盖 SPEC 集成测试 4、7；用真实 codex 做一次 needs_input → reply 的手工 e2e
  - Files: `src/supervisor.ts`, `src/tasks.ts`, `src/cli.ts`, `test/lifecycle.test.ts`
  - Deps: T5

- [x] Task 9: ls 与 prune（S）
  - Acceptance:
    - `ls` 默认只列当前 cwd 的任务，按更新时间倒序，`--all` 列出全部
    - `prune --older N` 只删除早于阈值、且不在 `running` 的任务，返回删除清单
  - Verify: `node --test test/observe.test.ts`，覆盖 SPEC 集成测试 8
  - Files: `src/tasks.ts`, `src/cli.ts`, `test/observe.test.ts`
  - Deps: T5

## Checkpoint: codex 全流程

- [x] `npm test` 全绿
- [ ] 只用 shell 跑通真实 codex：`start` → `tail -f` → `wait --for 50` 循环 → `reply` → `success`
- [ ] 与你一起评审之后，再进入 Phase 3

本轮自动化验证：`npm test` 60/60 通过（含 `tsc --noEmit` 和全部旧测试）。Task 1–9 已完成；以下手工验证仍待人工执行，不计为已验证：Task 5 的 Claude Code Bash 发起后退出会话、Task 7 的独立终端 `tail -f`、Task 8 及本检查点的真实 codex 多轮全流程。codex fixture 为构造测试样本，未录制真实 CLI 输出。

## Phase 3: 其余适配器

- [x] Task 10: 录真实 fixture（S，手工）——`test/fixtures/{codex-0.167.0,claude-2.1.323,cursor-2026.11.11,agy-1.5.6}.stream.jsonl`
  - Acceptance:
    - 用真实 CLI 各跑一单"读一个文件并回复"的任务，录下 claude、cursor、agy 的 stream-json 输出，存为 `test/fixtures/<t>.stream.jsonl`，文件头部注释记录 CLI 版本
    - fixture 中不含 token 或密钥
  - Verify: 人工检查 fixture 内容，`grep -iE "token|key|secret"` 无命中
  - Files: `test/fixtures/{claude,cursor,agy}.stream.jsonl`
  - Deps: T9

- [x] Task 11: claude 适配器（S）
  - Acceptance:
    - 使用 `-p --output-format stream-json --verbose`；effort 和 resume 沿用现状
    - 解析 `assistant` 的 text 和 tool_use、`user` 的 tool_result、`result`，以及 session_id
  - Verify: `node --test test/adapters.test.ts`；手工 e2e 一单任务加一次 reply，运行中 `tail -f` 能看到事件（成功标准 4）
  - Files: `src/adapters/claude.ts`, `src/adapters/index.ts`, `test/adapters.test.ts`
  - Deps: T10

- [x] Task 12: cursor 与 agy 适配器（S）
  - Acceptance:
    - cursor 使用 `--print --output-format stream-json`，agy 使用 `--print … --output-format stream-json`
    - 现有的 effort、模式、续会话参数保持不变；按 fixture 解析出事件和 session id
  - Verify: `node --test test/adapters.test.ts`；两家各做一次手工 e2e，含 reply
  - Files: `src/adapters/cursor.ts`, `src/adapters/agy.ts`, `src/adapters/index.ts`, `test/adapters.test.ts`
  - Deps: T10

- [ ] Task 13: gemini 适配器（S，样本受阻）——2026-11-13 决定先跳过
  - Acceptance:
    - 使用 `-p … -o stream-json`，`--resume <uuid>`，effort 仍给出 warning
    - 解析器先按 gemini-cli 源码里的 stream-json 事件类型编写；手写 fixture 时文件头标注"按源码构造，待真实样本替换"
  - Verify: `node --test test/adapters.test.ts`；真实 e2e 待鉴权修好后补做，并在 PR 里注明
  - Files: `src/adapters/gemini.ts`, `src/adapters/index.ts`, `test/fixtures/gemini.stream.jsonl`, `test/adapters.test.ts`
  - Deps: T9

## Checkpoint: 适配器

- [ ] `npm test` 全绿
- [ ] claude、cursor、agy、codex 四家都完成手工 e2e（含 reply）；gemini 标记为待补

## Phase 4: 接入与切换

- [x] Task 14: MCP 薄壳（S）
  - Acceptance:
    - `src/mcp.ts` 注册 `list_agents`、`delegate_task`、`task_status`、`task_wait`（参数 `task_ids` 加 `wait_seconds`，默认 50，上限 55）、`task_reply`、`task_cancel`、`task_list`
    - 每个工具都直接调用 `tasks.ts`，不在 MCP 进程里保存任何任务状态
    - 保留进度通知
  - Verify: `node --test test/mcp.test.ts`（用 SDK 的 in-memory transport 调用每个工具）；手工确认：通过 MCP 发起的任务，在 MCP 重启后仍能 `baton status` 读到（成功标准 1）
  - Files: `src/mcp.ts`, `src/cli.ts`, `test/mcp.test.ts`
  - Deps: T9

- [x] Task 15: 切换入口、删除旧代码、升到 0.3.0（M，大部分是删除）——gemini 适配器随旧代码删除，0.3.0 不含 gemini（见 SPEC 已决定 7）
  - Acceptance:
    - `mcp_config.json`、`gemini-extension.json`、`.codex-mcp.json`、`.cursor-mcp.json` 和 `package.json` 的 `bin` 都指向 `src/cli.ts`
    - 删除 `src/*.mjs`、`src/adapters/*.mjs`、`test/baton.test.mjs`；仍有价值的旧测试，确认已迁到 `.ts` 之后再删
    - 版本号统一为 `0.3.0`：`package.json`、`package-lock.json`、`plugin.json`、`gemini-extension.json`、`src/mcp.ts`、`.claude-plugin/*`、`.codex-plugin/plugin.json`、`.cursor-plugin/plugin.json`、`.agents/plugins/marketplace.json`
  - Verify: `npm test`；`git ls-files 'src/*.mjs'` 输出为空；`node src/cli.ts mcp` 能启动；在 Claude Code 里重装插件后，`list_agents` 可用
  - Files: 上面列出的清单文件，以及要删除的旧文件
  - Deps: T11, T12, T13, T14

- [x] Task 16: 改写 skills（S）
  - Acceptance:
    - `baton-rescue`、`baton-orchestrate` 改成 shell 优先：先 `baton start`，再循环 `baton wait --for 50`；遇到 `needs_input` 就转问用户或代为回答，然后 `baton reply`
    - MCP 只作为备选入口；不再要求宿主开后台子 Agent；宿主特有能力只写成可选提示
    - 删除所有 `session_id` 续派、`task_wait_any` 和 1800s 上限的说法
  - Verify: `grep -rnE "task_wait_any|1800|session_id" skills/` 不再命中旧用法；把 skill 里的命令逐条手工跑一遍
  - Files: `skills/baton-rescue/SKILL.md`, `skills/baton-orchestrate/SKILL.md`
  - Deps: T15

- [x] Task 17: README 与文档（S）
  - Acceptance:
    - `README.md` 和 `README.zh-CN.md` 写明新的命令面、`~/.baton` 目录布局、Node 24 要求、0.3.0 的破坏性变更
    - `docs/Baton设计方案.md` 顶部注明"MCP 作为核心媒介"这一设计已被 `SPEC.md` 取代
  - Verify: 文档中的每条命令都手工跑通
  - Files: `README.md`, `README.zh-CN.md`, `docs/Baton设计方案.md`
  - Deps: T15

## Checkpoint: Complete

- [ ] `npm test` 全绿，覆盖率不低于 80%
- [ ] SPEC 成功标准 1–8 逐条核对
- [ ] 你评审之后开 PR
