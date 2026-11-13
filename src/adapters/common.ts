import fs from "node:fs";
import path from "node:path";

export function which(names: string[], env = process.env) {
  const dirs = (env.PATH || "").split(path.delimiter).filter(Boolean);
  for (const name of names) {
    for (const dir of dirs) {
      const full = path.join(dir, name);
      try {
        const stat = fs.statSync(full);
        if (!stat.isFile()) continue;
        fs.accessSync(full, fs.constants.X_OK);
        return full;
      } catch {
        // Try the next PATH entry.
      }
    }
  }
  return null;
}

export function authHit(text: string, phrases: string[]) {
  const hay = String(text || "").toLowerCase();
  return phrases.some((phrase) => hay.includes(phrase));
}
