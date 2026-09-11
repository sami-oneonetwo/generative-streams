export function log(scope: string, msg: string, extra?: unknown): void {
  const ts = new Date().toTimeString().slice(0, 8);
  const tail = extra === undefined ? '' : ' ' + safeJson(extra);
  console.log(`${ts} [${scope}] ${msg}${tail}`);
}

function safeJson(v: unknown): string {
  try {
    return typeof v === 'string' ? v : JSON.stringify(v);
  } catch {
    return String(v);
  }
}
