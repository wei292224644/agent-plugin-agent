import { spawnSync } from "node:child_process";

export function gitSnapshot(cwd) {
  const result = spawnSync("git", ["status", "--porcelain"], {
    cwd,
    encoding: "utf8",
    timeout: 5000,
  });
  if (result.error || result.status !== 0) return null;
  const entries = new Map();
  for (const line of result.stdout.split("\n")) {
    if (line.length < 4) continue;
    const body = line.slice(3);
    const filePath = body.includes(" -> ") ? body.split(" -> ").pop() : body;
    entries.set(filePath, line);
  }
  return entries;
}

export function gitChanges(cwd, before, after) {
  if (!before || !after) return undefined;
  const paths = [];
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    if (before.get(key) !== after.get(key)) paths.push(key);
  }
  if (paths.length === 0) {
    return { files_changed: 0, insertions: 0, deletions: 0, diff_stat: "" };
  }

  const tracked = paths.filter((filePath) => !String(after.get(filePath) || "").startsWith("??"));
  let diffStat = "";
  if (tracked.length) {
    // shortcut: 超过 50 个路径就不再逐个点名，升级时改成 --raw 再过滤。
    const result = spawnSync("git", ["diff", "--stat", "--", ...tracked.slice(0, 50)], {
      cwd,
      encoding: "utf8",
      timeout: 5000,
    });
    diffStat = (result.stdout || "").trim();
  }
  const untracked = paths.filter((filePath) => String(after.get(filePath) || "").startsWith("??"));
  if (untracked.length) {
    const extra = untracked.map((filePath) => `${filePath} | untracked`).join("\n");
    diffStat = diffStat ? `${diffStat}\n${extra}` : extra;
  }
  return {
    files_changed: paths.length,
    insertions: Number(diffStat.match(/(\d+) insertion/)?.[1] || 0),
    deletions: Number(diffStat.match(/(\d+) deletion/)?.[1] || 0),
    diff_stat: diffStat,
  };
}
