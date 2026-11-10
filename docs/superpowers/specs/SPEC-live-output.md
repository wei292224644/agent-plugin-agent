# Spec: live-output

日期：2026-11-10  
Module: `live-output`（Issue #7）  
状态：已完成（随 fix/open-issues-7-9-10 落地）

## Objective

运行中 `task_status` 返回最近输出与 `last_output_at`。流式 JSON 取最近完整消息；否则回退原始 stdout 尾部。

## Success Criteria

- [x] 运行中 `output` 非空（有 stdout 时）
- [x] 有 `last_output_at`
- [x] NDJSON 取最近 `result` 字段
- [x] `npm test` 含回归
