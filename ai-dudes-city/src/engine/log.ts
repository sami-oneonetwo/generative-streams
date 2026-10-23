import fs from 'node:fs';
import path from 'node:path';

export type LogLevel = 'info' | 'warn' | 'alert';

export interface LogLine {
  ts: number;
  level: LogLevel;
  text: string;
}

const RING_SIZE = 200;
/** terminal.jsonl rolls over to terminal.1.jsonl (one old file kept) past this size. */
export const LOG_ROTATE_BYTES = 5 * 1024 * 1024;

export class TerminalLog {
  private lines: LogLine[] = [];
  private jsonlPath: string;
  private bytes = 0;

  constructor(dataDir: string) {
    const dir = path.join(dataDir, 'log');
    fs.mkdirSync(dir, { recursive: true });
    this.jsonlPath = path.join(dir, 'terminal.jsonl');
    try {
      this.bytes = fs.statSync(this.jsonlPath).size;
    } catch {
      this.bytes = 0;
    }
    this.rotate();
  }

  /** Past the size limit the file moves aside (replacing the last old one) and a fresh one starts. */
  private rotate(): void {
    if (this.bytes < LOG_ROTATE_BYTES) return;
    try {
      fs.renameSync(this.jsonlPath, this.jsonlPath.replace(/\.jsonl$/, '.1.jsonl'));
    } catch {
      // not there or not movable: keep appending; the next start tries again
    }
    this.bytes = 0;
  }

  push(text: string, level: LogLevel = 'info'): void {
    const line: LogLine = { ts: Date.now(), level, text };
    this.lines.push(line);
    if (this.lines.length > RING_SIZE) this.lines.shift();
    const row = JSON.stringify(line) + '\n';
    this.bytes += Buffer.byteLength(row);
    this.rotate();
    fs.appendFile(this.jsonlPath, row, () => {});
    // eslint-disable-next-line no-console
    console.log(`[world] ${level !== 'info' ? level.toUpperCase() + ' ' : ''}${text}`);
  }

  tail(n: number): string[] {
    return this.lines.slice(-n).map((l) => {
      const t = new Date(l.ts).toTimeString().slice(0, 8);
      return `${t} ${l.level === 'alert' ? '!! ' : ''}${l.text}`;
    });
  }
}

/** The last `maxBytes` of a file (the first line may come back torn), or '' when there is none. */
export function readTail(file: string, maxBytes: number): string {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const length = Math.min(size, maxBytes);
    const buf = Buffer.alloc(length);
    fs.readSync(fd, buf, 0, length, size - length);
    return buf.toString('utf8');
  } catch {
    return '';
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}
