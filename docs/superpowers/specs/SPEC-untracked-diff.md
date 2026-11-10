# Spec: untracked-diff

日期：2026-11-10  
Module: `untracked-diff`（Issue #9）  
状态：已完成（随 fix/open-issues-7-9-10 落地）

## Objective

未跟踪文件前后都是 `??` 时，按内容哈希检测修改，并给出插入行数。

## Success Criteria

- [x] 同路径保持 `??` 但内容变 → `files_changed >= 1`
- [x] `diff_stat` 含 untracked 与 `+N`
- [x] `npm test` 含回归
