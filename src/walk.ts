import { opendir } from 'node:fs/promises';
import { join } from 'node:path';
import { SKIP_DIRS } from './paths.js';

export const MAX_WALK_FILES = 20_000;

/**
 * Archivos bajo `dir`, sin entrar en `SKIP_DIRS` ni seguir symlinks (no se escapa de la carpeta).
 */
export async function* walkFiles(dir: string): AsyncGenerator<string> {
  let seen = 0;
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let handle;
    try {
      handle = await opendir(current);
    } catch {
      continue;
    }
    for await (const entry of handle) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          stack.push(full);
        }
      } else if (entry.isFile()) {
        yield full;
        seen += 1;
        if (seen >= MAX_WALK_FILES) {
          return;
        }
      }
    }
  }
}
