import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

function digestFile(cwd, filePath) {
  try {
    const full = path.join(cwd, filePath);
    const data = fs.readFileSync(full);
    return crypto.createHash("sha256").update(data).digest("hex");
  } catch {
    return null;
  }
}

function normalizeSnapshot(snapshot) {
  if (!snapshot) return null;
  if (snapshot.porcelain instanceof Map) return snapshot;
  if (snapshot instanceof Map) return { porcelain: snapshot, digests: new Map() };
  return null;
}

export function gitSnapshot(cwd) {
  const result = spawnSync("git", ["status", "--porcelain"], {
    cwd,
    encoding: "utf8",
    timeout: 5000,
  });
  if (result.error || result.status !== 0) return null;
  const porcelain = new Map();
  const digests = new Map();
  for (const line of result.stdout.split("\n")) {
    if (line.length < 4) continue;
    const body = line.slice(3);
    const filePath = body.includes(" -> ") ? body.split(" -> ").pop() : body;
    porcelain.set(filePath, line);
    if (line.startsWith("??")) {
      const digest = digestFile(cwd, filePath);
      if (digest) digests.set(filePath, digest);
    }
  }
  return { porcelain, digests };
}

function untrackedInsertions(cwd, filePath) {
  try {
    const text = fs.readFileSync(path.join(cwd, filePath), "utf8");
    if (!text) return 0;
    const lines = text.split("\n");
    return text.endsWith("\n") ? Math.max(lines.length - 1, 0) : lines.length;
  } catch {
    return 0;
  }
}

export function gitChanges(cwd, beforeRaw, afterRaw) {
  const before = normalizeSnapshot(beforeRaw);
  const after = normalizeSnapshot(afterRaw);
  if (!before || !after) return undefined;
  const paths = [];
  for (const key of new Set([...before.porcelain.keys(), ...after.porcelain.keys()])) {
    const lineChanged = before.porcelain.get(key) !== after.porcelain.get(key);
    const digestChanged = before.digests.get(key) !== after.digests.get(key)
      && (before.digests.has(key) || after.digests.has(key));
    if (lineChanged || digestChanged) paths.push(key);
  }
  if (paths.length === 0) {
    return { files_changed: 0, insertions: 0, deletions: 0, diff_stat: "" };
  }

  const tracked = paths.filter((filePath) => !String(after.porcelain.get(filePath) || "").startsWith("??"));
  let diffStat = "";
  let insertions = 0;
  let deletions = 0;
  if (tracked.length) {
    // shortcut: 超过 50 个路径就不再逐个点名，升级时改成 --raw 再过滤。
    const result = spawnSync("git", ["diff", "--stat", "--", ...tracked.slice(0, 50)], {
      cwd,
      encoding: "utf8",
      timeout: 5000,
    });
    diffStat = (result.stdout || "").trim();
    insertions = Number(diffStat.match(/(\d+) insertion/)?.[1] || 0);
    deletions = Number(diffStat.match(/(\d+) deletion/)?.[1] || 0);
  }
  const untracked = paths.filter((filePath) => String(after.porcelain.get(filePath) || "").startsWith("??"));
  if (untracked.length) {
    const extras = [];
    for (const filePath of untracked) {
      const added = untrackedInsertions(cwd, filePath);
      insertions += added;
      extras.push(`${filePath} | untracked +${added}`);
    }
    const extra = extras.join("\n");
    diffStat = diffStat ? `${diffStat}\n${extra}` : extra;
  }
  return {
    files_changed: paths.length,
    insertions,
    deletions,
    diff_stat: diffStat,
  };
}
