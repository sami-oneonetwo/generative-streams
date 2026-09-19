import fs from 'node:fs';
import path from 'node:path';
import type { WorldModule } from './world';

/** Thrown when a snapshot is from newer code; fatal, never recovered from. */
export class StateVersionError extends Error {}

export function statePath(dataDir: string, worldId: string): string {
  return path.join(dataDir, `world-${worldId}.json`);
}

export function loadState<S>(
  world: WorldModule<S>,
  dataDir: string,
  log: (line: string, level?: 'info' | 'warn' | 'alert') => void,
): S {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = statePath(dataDir, world.meta.id);

  let existingSnapshot = false;
  for (const candidate of [file, `${file}.bak`]) {
    try {
      if (!fs.existsSync(candidate)) continue;
      existingSnapshot = true;
      let raw: unknown = JSON.parse(fs.readFileSync(candidate, 'utf8'));
      const version = (raw as { version?: unknown })?.version;
      // Data written by newer code than we're running: starting fresh here
      // would autosave empty state over good data (this exact bug bit us once).
      // Refuse to boot instead — the operator should run matching code.
      if (typeof version === 'number' && version > world.meta.stateVersion) {
        throw new StateVersionError(
          `${path.basename(candidate)} is state version ${version}, but this build only understands up to ${world.meta.stateVersion}. ` +
            `Refusing to start so a fresh snapshot can't overwrite newer data. Run newer code, or move the file aside.`,
        );
      }
      if (typeof version === 'number' && version < world.meta.stateVersion) {
        raw = world.migrate(raw, version);
      }
      const parsed = world.stateSchema.safeParse(raw);
      if (parsed.success) {
        log(`state loaded from ${path.basename(candidate)}`);
        return parsed.data;
      }
      // A file that parsed as JSON and carried a version, but doesn't satisfy
      // the schema, means the code and the data disagree — a missing migration,
      // or a stateVersion that wasn't bumped alongside the schema. Starting
      // fresh would autosave an empty room over a real one, so refuse. (This
      // is the same hazard as the newer-data case above, from the other side;
      // it cost a dev room's boxes once, mid-edit, under a file watcher.)
      if (typeof version === 'number') {
        throw new StateVersionError(
          `${path.basename(candidate)} is state version ${version} and this build expects ${world.meta.stateVersion}, ` +
            `but it does not match the schema: ${parsed.error.issues[0]?.message ?? 'schema error'} ` +
            `(at ${parsed.error.issues[0]?.path.join('.') || 'root'}). Refusing to start so a fresh snapshot can't ` +
            `overwrite real data. Fix the migration, or move the file aside to start over deliberately.`,
        );
      }
      log(
        `state file ${path.basename(candidate)} invalid: ${parsed.error.issues[0]?.message ?? 'schema error'}`,
        'warn',
      );
    } catch (e) {
      if (e instanceof StateVersionError) throw e; // fatal — never fall through to fresh
      log(`state file ${path.basename(candidate)} unreadable: ${(e as Error).message}`, 'warn');
    }
  }

  if (existingSnapshot) {
    throw new StateVersionError(
      `No readable snapshot for '${world.meta.id}'. Refusing to overwrite existing data; recover a backup or move the files aside deliberately.`,
    );
  }
  log('starting with fresh state');
  return world.createInitialState(Date.now());
}

/** Keep a timestamped copy of the current snapshot before something destructive (a world reset). */
export function backupState<S>(world: WorldModule<S>, dataDir: string, label: string): string | null {
  const file = statePath(dataDir, world.meta.id);
  if (!fs.existsSync(file)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const copy = path.join(dataDir, `world-${world.meta.id}.${label}-${stamp}.json`);
  fs.copyFileSync(file, copy);
  return copy;
}

/** Atomic snapshot: write tmp, fsync, rotate previous to .bak, rename over. */
export function saveState<S>(world: WorldModule<S>, dataDir: string, state: S): void {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = statePath(dataDir, world.meta.id);
  const tmp = `${file}.tmp`;
  const json = JSON.stringify(state, null, 2);
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, json);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
  fs.renameSync(tmp, file);
}
