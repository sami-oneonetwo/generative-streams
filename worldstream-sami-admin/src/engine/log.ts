import fs from 'node:fs';
import path from 'node:path';

export type LogLevel = 'info' | 'warn' | 'alert';

export interface LogLine {
  ts: number;
  level: LogLevel;
  text: string;
}

const RING_SIZE = 200;

export class TerminalLog {
  private lines: LogLine[] = [];
  private jsonlPath: string;

  constructor(dataDir: string) {
    const dir = path.join(dataDir, 'log');
    fs.mkdirSync(dir, { recursive: true });
    this.jsonlPath = path.join(dir, 'terminal.jsonl');
  }

  push(text: string, level: LogLevel = 'info'): void {
    const line: LogLine = { ts: Date.now(), level, text };
    this.lines.push(line);
    if (this.lines.length > RING_SIZE) this.lines.shift();
    fs.appendFile(this.jsonlPath, JSON.stringify(line) + '\n', () => {});
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
