# Implementation Plan: Baton 核心重构（CLI + 磁盘状态 + 守护进程）

规格：`SPEC.md`
版本：`0.2.5` → `0.3.0`
状态：待审

## Overview

新核心用 TypeScript 写在 `src/*.ts`，和旧的 `.mjs` 并存，旧入口和旧测试一直能用。等新 CLI、四家适配器和 MCP 薄壳都通过之后，再一次性切换入口、删掉旧代码、升版本。

第一条纵向切片用 codex 打通 `start → supervise → status`。选 codex 是因为它的 `--json` 已经是流式输出，格式现成，适配器最好写。风险最高的"守护进程脱离父进程后能否存活"放在最前面验证。

## Architecture Decisions

- **新旧并存，最后再切换。** 每个任务结束时仓库都处于可用状态，`npm test` 同时跑旧的 `.mjs` 测试和新的 `.ts` 测试。
- **集成测试用假 CLI。** `test/fake-cli/` 放可执行脚本，命名为 `codex`、`claude` 等，放进 PATH 前面。脚本按环境变量控制行为：输出哪个 fixture、sleep 多久、以什么退出码退出、是否卡住。真实 CLI 只在手工 e2e 时使用。
- **supervisor 入口就是同一个 CLI**：`node <plugin>/src/cli.ts _supervise <id>`，`detached: true`、`stdio: "ignore"`、`unref()`。不另写守护进程脚本。
- **`scripts/setup.mjs` 保持 `.mjs`。** 它必须能在依赖没装好的情况下运行，也和本次重构无关。spec 第 8 条成功标准已允许这个例外。
- **`git.ts`、`contract.ts` 原样迁移逻辑**，只加类型，不改行为，并把对应的旧测试一起迁过来。

## Dependency Graph

```
T1 工具链
 └─ T2 store/types ─┬─ T3 contract/git
                    └─ T4 codex 适配器
                          └─ T5 start/supervise/status  ←（风险最高）
                                ├─ T6 存活/超时/取消/孤儿
                                ├─ T7 wait/tail
                                ├─ T8 reply/turns
                                └─ T9 ls/prune
                                      ├─ T10 录 fixture ─┬─ T11 claude
                                      │                  ├─ T12 cursor+agy
                                      │                  └─ T13 gemini（样本受阻）
                                      └─ T14 MCP 薄壳
                                            └─ T15 切换入口、删旧代码、升 0.3.0
                                                  └─ T16 skills ── T17 README/docs
```

## Task List

见 `tasks/todo.md`。

- Phase 1 基础：T1–T4
- Phase 2 核心流程（codex）：T5–T9
- Phase 3 其余适配器：T10–T13
- Phase 4 接入与切换：T14–T17

## Parallelization

- T6、T7、T8、T9 都只依赖 T5，可以并行；但它们都会改 `src/tasks.ts` 和 `src/cli.ts`，并行时需要协调，所以建议串行做。
- T11、T12、T13 互相独立，各自只改自己的适配器文件，可以并行。
- T16、T17 可以并行。

## Risks and Mitigations

| 风险 | 影响 | 缓解 |
|---|---|---|
| detached 的 supervisor 在宿主 kill 进程组或关闭终端时被连带杀掉 | 高 | T5 的集成测试真的 kill 父进程，在 macOS 上实测；手工检查从 Claude Code 的 Bash 工具里发起的任务能否存活 |
| 读命令判 orphaned 时，supervisor 只是心跳写慢了 | 中 | 心跳 10s 一次，阈值 30s；补写终态前再做一次 `kill(pid, 0)` 检查 |
| 各家 stream-json 格式和预期不符，或随版本变化 | 中 | 解析器认不出的行一律记为 `raw`，不会丢输出；fixture 文件名带 CLI 版本号 |
| 本机 gemini 鉴权失败，录不到样本 | 中 | T13 先按源码里的事件类型写解析器，fixture 和 e2e 标记为待补；不阻塞 T15 |
| Node 24 下 `node --test` 默认不收集 `.ts` 测试文件 | 低 | `npm test` 里显式写出 glob，T1 当场验证 |
| `turns/` 和 `raw/` 里存有 prompt 原文 | 中 | 目录 `0700`、文件 `0600`，T2 测试权限位 |
| 子 CLI 长时间思考、完全不输出，被空闲超时误杀 | 低 | 默认 600s，可按单调整；`timed_out` 的 summary 注明是 `idle` 导致的 |

## Open Questions

无。gemini 样本的录制环境等你方便时再提供。
