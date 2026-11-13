export function redact(text: string): string {
  let safe = text;
  for (const [key, value] of Object.entries(process.env)) {
    if (/TOKEN|SECRET|PASSWORD|API_KEY|CREDENTIAL/i.test(key) && value && value.length >= 4) safe = safe.split(value).join("[REDACTED]");
  }
  return safe.replace(/(Bearer\s+)[\w.\-]+/gi, "$1[REDACTED]")
    .replace(/((?:api[_-]?key|token|secret|password)["']?\s*[=:]\s*["']?)[^\s"',;}]+/gi, "$1[REDACTED]");
}

