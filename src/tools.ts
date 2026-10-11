import { spawn } from 'node:child_process';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import picomatch from 'picomatch';
import { config } from './config.js';
import { displayPath, isSecretFile, PathError, resolveAllowed, SKIP_DIRS } from './paths.js';
import { walkFiles } from './walk.js';

const MAX_READ_BYTES = 2 * 1024 * 1024;
const DEFAULT_READ_LINES = 400;
const MAX_READ_LINES = 2000;
const MAX_LIST_ENTRIES = 500;
const MAX_RESULTS = 200;
const MAX_SEARCH_FILE_BYTES = 1024 * 1024;
const MAX_LINE_CHARS = 300;
const MAX_TERMINAL_OUTPUT_BYTES = 64 * 1024;
const DEFAULT_TERMINAL_TIMEOUT_MS = 30_000;
const MAX_TERMINAL_TIMEOUT_MS = 120_000;

function isBinary(buffer: Buffer): boolean {
  return buffer.subarray(0, 8000).includes(0);
}

async function readText(path: string, maxBytes: number): Promise<string | null> {
  const info = await stat(path);
  if (!info.isFile()) {
    throw new PathError(`No es un archivo: ${displayPath(path)}`);
  }
  if (info.size > maxBytes) {
    return null;
  }
  const buffer = await readFile(path);
  return isBinary(buffer) ? null : buffer.toString('utf8');
}

function clip(line: string): string {
  return line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS)}…` : line;
}

export function listRoots(): string {
  const mode = config.readOnly ? 'solo lectura' : 'lectura y escritura';
  const terminal = config.terminalEnabled && !config.readOnly ? 'habilitada' : 'deshabilitada';
  return [
    `Modo: ${mode}`,
    `Ejecución de comandos en terminal: ${terminal}`,
    'Carpetas habilitadas (las rutas relativas parten de la primera):',
    ...config.roots,
  ].join('\n');
}

/** Ejecuta un comando de una sola vez en el shell del sistema. Requiere habilitación explícita. */
export async function runTerminal(command: string, inputCwd?: string, timeoutMs = DEFAULT_TERMINAL_TIMEOUT_MS): Promise<string> {
  if (!config.terminalEnabled || config.readOnly) {
    throw new Error('La terminal está deshabilitada. Configurá PC_MCP_ENABLE_TERMINAL=true y PC_MCP_READ_ONLY=false para habilitarla.');
  }
  if (!command.trim()) {
    throw new Error('El comando no puede estar vacío');
  }

  const cwd = await resolveAllowed(inputCwd ?? config.roots[0]);
  if (!(await stat(cwd)).isDirectory()) {
    throw new PathError(`El directorio de trabajo no es una carpeta: ${displayPath(cwd)}`);
  }
  const timeout = Math.min(Math.max(timeoutMs, 1_000), MAX_TERMINAL_TIMEOUT_MS);

  return new Promise((resolve, reject) => {
    const child = spawn(command, [], {
      cwd,
      shell: true,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout: string[] = [];
    const stderr: string[] = [];
    let bytes = 0;
    let timedOut = false;
    let truncated = false;
    let settled = false;
    let killTimer: NodeJS.Timeout | undefined;
    let timeoutTimer: NodeJS.Timeout | undefined;

    const append = (target: string[], chunk: Buffer): void => {
      const remaining = MAX_TERMINAL_OUTPUT_BYTES - bytes;
      if (remaining > 0) {
        const kept = chunk.subarray(0, remaining);
        target.push(kept.toString('utf8'));
        bytes += kept.length;
      }
      if (chunk.length > remaining && !truncated) {
        truncated = true;
        child.kill();
        killTimer = setTimeout(() => child.kill('SIGKILL'), 1_000);
        killTimer.unref();
      }
    };

    child.stdout.on('data', (chunk: Buffer) => append(stdout, chunk));
    child.stderr.on('data', (chunk: Buffer) => append(stderr, chunk));
    child.on('error', (error) => {
      if (!settled) {
        settled = true;
        if (timeoutTimer) clearTimeout(timeoutTimer);
        if (killTimer) clearTimeout(killTimer);
        reject(error);
      }
    });

    timeoutTimer = setTimeout(() => {
      timedOut = true;
      child.kill();
      killTimer = setTimeout(() => child.kill('SIGKILL'), 1_000);
      killTimer.unref();
    }, timeout);
    timeoutTimer.unref();

    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);
      const status = timedOut ? `timeout después de ${timeout} ms` : `código de salida: ${code ?? signal ?? 'desconocido'}`;
      const output = [
        `$ ${command}`,
        `directorio: ${displayPath(cwd)}`,
        status,
        stdout.length ? `stdout:\n${stdout.join('')}` : '',
        stderr.length ? `stderr:\n${stderr.join('')}` : '',
        truncated ? `\n… salida truncada en ${MAX_TERMINAL_OUTPUT_BYTES} bytes` : '',
      ].filter(Boolean).join('\n');
      resolve(output);
    });
  });
}

export async function listDir(input: string, depth = 1): Promise<string> {
  const root = await resolveAllowed(input);
  const maxDepth = Math.min(Math.max(depth, 1), 3);
  const lines: string[] = [`${displayPath(root)}/`];
  let count = 0;

  async function visit(dir: string, level: number): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (count >= MAX_LIST_ENTRIES) {
        return;
      }
      count += 1;
      const indent = '  '.repeat(level);
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        const skipped = SKIP_DIRS.has(entry.name);
        lines.push(`${indent}${entry.name}/${skipped ? ' (no se recorre)' : ''}`);
        if (!skipped && level < maxDepth) {
          await visit(full, level + 1);
        }
      } else if (entry.isFile()) {
        const size = (await stat(full).catch(() => null))?.size ?? 0;
        lines.push(`${indent}${entry.name} (${size} B)${isSecretFile(full) ? ' [bloqueado]' : ''}`);
      }
    }
  }

  await visit(root, 1);
  if (count >= MAX_LIST_ENTRIES) {
    lines.push(`… cortado en ${MAX_LIST_ENTRIES} entradas`);
  }
  return lines.join('\n');
}

export async function readTextFile(input: string, offset = 1, limit = DEFAULT_READ_LINES): Promise<string> {
  const path = await resolveAllowed(input);
  const text = await readText(path, MAX_READ_BYTES);
  if (text === null) {
    throw new PathError(`Binario o mayor a ${MAX_READ_BYTES} bytes: ${displayPath(path)}`);
  }
  const lines = text.split(/\r?\n/);
  const start = Math.max(offset, 1);
  const count = Math.min(Math.max(limit, 1), MAX_READ_LINES);
  const slice = lines.slice(start - 1, start - 1 + count);
  const end = start - 1 + slice.length;
  const header = `${displayPath(path)} — líneas ${start}-${end} de ${lines.length}`;
  const body = slice.map((line, index) => `${start + index}|${line}`).join('\n');
  const more = end < lines.length ? `\n… quedan ${lines.length - end} líneas (usá offset=${end + 1})` : '';
  return `${header}\n${body}${more}`;
}

function relativePosix(base: string, file: string): string {
  return relative(base, file).split(sep).join('/');
}

export async function findFiles(pattern: string, input?: string): Promise<string> {
  const base = await resolveAllowed(input ?? config.roots[0]);
  const matches = picomatch(pattern, { dot: true, nocase: process.platform === 'win32' });
  const found: string[] = [];
  for await (const file of walkFiles(base)) {
    const rel = relativePosix(base, file);
    if (matches(rel) || matches(rel.split('/').pop()!)) {
      found.push(displayPath(file));
      if (found.length >= MAX_RESULTS) {
        break;
      }
    }
  }
  if (found.length === 0) {
    return `Sin resultados para ${pattern}`;
  }
  const more = found.length >= MAX_RESULTS ? `\n… cortado en ${MAX_RESULTS}` : '';
  return `${found.join('\n')}${more}`;
}

export async function searchText(
  pattern: string,
  options: { path?: string; glob?: string; ignoreCase?: boolean; literal?: boolean },
): Promise<string> {
  const base = await resolveAllowed(options.path ?? config.roots[0]);
  const source = options.literal ? pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : pattern;
  let regex: RegExp;
  try {
    regex = new RegExp(source, options.ignoreCase ? 'i' : '');
  } catch (error) {
    throw new Error(`Regex inválida: ${(error as Error).message}`);
  }
  const fileFilter = options.glob
    ? picomatch(options.glob, { dot: true, nocase: process.platform === 'win32' })
    : null;

  const hits: string[] = [];
  outer: for await (const file of walkFiles(base)) {
    if (isSecretFile(file)) {
      continue;
    }
    const rel = relativePosix(base, file);
    if (fileFilter && !fileFilter(rel) && !fileFilter(rel.split('/').pop()!)) {
      continue;
    }
    const text = await readText(file, MAX_SEARCH_FILE_BYTES).catch(() => null);
    if (text === null) {
      continue;
    }
    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      if (regex.test(lines[index])) {
        hits.push(`${displayPath(file)}:${index + 1}: ${clip(lines[index].trim())}`);
        if (hits.length >= MAX_RESULTS) {
          break outer;
        }
      }
    }
  }
  if (hits.length === 0) {
    return `Sin coincidencias para ${pattern}`;
  }
  const more = hits.length >= MAX_RESULTS ? `\n… cortado en ${MAX_RESULTS}` : '';
  return `${hits.join('\n')}${more}`;
}

export async function writeTextFile(input: string, content: string): Promise<string> {
  const path = await resolveAllowed(input, { write: true });
  const existed = await stat(path).then((info) => {
    if (!info.isFile()) {
      throw new PathError(`No es un archivo: ${displayPath(path)}`);
    }
    return true;
  }, () => false);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf8');
  return `${existed ? 'Reemplazado' : 'Creado'} ${displayPath(path)} (${Buffer.byteLength(content)} B)`;
}

function countOccurrences(text: string, search: string): number {
  let count = 0;
  let index = text.indexOf(search);
  while (index !== -1) {
    count += 1;
    index = text.indexOf(search, index + search.length);
  }
  return count;
}

/**
 * Reemplazo de texto exacto. Si el archivo usa CRLF y el modelo mandó LF, se adapta.
 */
export async function editTextFile(
  input: string,
  oldString: string,
  newString: string,
  replaceAll = false,
): Promise<string> {
  const path = await resolveAllowed(input, { write: true });
  const text = await readText(path, MAX_READ_BYTES);
  if (text === null) {
    throw new PathError(`Binario o mayor a ${MAX_READ_BYTES} bytes: ${displayPath(path)}`);
  }
  if (!oldString) {
    throw new Error('old_string no puede estar vacío');
  }
  let search = oldString;
  let replacement = newString;
  if (!text.includes(search) && text.includes('\r\n') && !search.includes('\r\n')) {
    search = search.replace(/\n/g, '\r\n');
    replacement = replacement.replace(/\r?\n/g, '\r\n');
  }
  const count = countOccurrences(text, search);
  if (count === 0) {
    throw new Error(`old_string no aparece en ${displayPath(path)}. Leé el archivo y copiá el texto exacto.`);
  }
  if (count > 1 && !replaceAll) {
    throw new Error(`old_string aparece ${count} veces en ${displayPath(path)}. Agregá contexto o usá replace_all.`);
  }
  const updated = replaceAll ? text.split(search).join(replacement) : text.replace(search, () => replacement);
  await writeFile(path, updated, 'utf8');
  return `Editado ${displayPath(path)} (${replaceAll ? count : 1} reemplazo${count > 1 && replaceAll ? 's' : ''})`;
}
