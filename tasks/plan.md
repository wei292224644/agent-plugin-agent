# Plan: result-markers

规格：`docs/superpowers/specs/SPEC-result-markers.md`  
Issue：#10  
状态：待确认

## Approach

把注入给下游的输出契约从 `APA_*` 换成 `BATON_*`；`interpret` 同时认新旧两套；测试主路径用新标记，留一条旧标记兼容；README 中英各加一句改名说明。不改 package / marketplace 名。

## Components

| 组件 | 动作 |
|---|---|
| `src/runner.mjs` `OUTPUT_CONTRACT` | 只教 `BATON_DECISION` / `BATON_RESULT` / `BATON_END` |
| `src/runner.mjs` `interpret` | 正则同时匹配 `APA_` 与 `BATON_` 前缀 |
| `test/baton.test.mjs` | 主夹具改新标记；`interpret` 测新旧 |
| `README.md` / `README.zh-CN.md` | 一句 apa→baton 改名说明 |

## Order

1. 先改 `interpret` + 失败测试（新旧都能解析）
2. 改 `OUTPUT_CONTRACT`，更新委派夹具里的标记
3. README 一句说明
4. `npm test`；关 #10

## Risks

| 风险 | 缓解 |
|---|---|
| 已在跑的下游仍打 `APA_*` | 解析兼认旧前缀 |
| 文档/设计稿里还有 APA 示例 | 本 module 只改用户可见 README + 运行时契约；历史设计稿不动，除非阻塞测试 |

## Checkpoint

`npm test` 全绿；契约文案无 `APA_`；`interpret` 新旧皆过；再关 issue。
