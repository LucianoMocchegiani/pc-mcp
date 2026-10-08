import { realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { config } from './config.js';

export class PathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PathError';
  }
}

/** Carpetas que no se recorren en búsquedas ni listados profundos. */
export const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.next',
  '.turbo',
  '.cache',
  '__pycache__',
  '.venv',
  'venv',
]);

/** Secretos: ni se leen ni se escriben (el contenido viajaría al proveedor del modelo). */
const SECRET_FILE = [
  /^\.env$/i,
  /^\.env\.(?!example$).+/i,
  /\.(pem|key|pfx|p12)$/i,
  /^id_(rsa|ecdsa|ed25519)/i,
  /^\.npmrc$/i,
];

export function isSecretFile(path: string): boolean {
  const name = basename(path);
  return SECRET_FILE.some((pattern) => pattern.test(name));
}

function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** Resuelve symlinks del tramo existente; el resto (archivo nuevo) se agrega tal cual. */
async function realpathAllowMissing(target: string): Promise<string> {
  const missing: string[] = [];
  let current = target;
  for (;;) {
    try {
      const real = await realpath(current);
      return missing.length > 0 ? join(real, ...missing.reverse()) : real;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
      const parent = dirname(current);
      if (parent === current) {
        return target;
      }
      missing.push(basename(current));
      current = parent;
    }
  }
}

/**
 * Ruta absoluta y real dentro de alguna carpeta habilitada, o `PathError`.
 *
 * @param input Absoluta, o relativa a la primera carpeta de `PC_MCP_ROOTS`.
 */
export async function resolveAllowed(
  input: string,
  options: { write?: boolean } = {},
): Promise<string> {
  if (!input?.trim()) {
    throw new PathError('Falta la ruta');
  }
  const absolute = isAbsolute(input) ? resolve(input) : resolve(config.roots[0], input);
  const real = await realpathAllowMissing(absolute);
  if (!config.roots.some((root) => isInside(root, real))) {
    throw new PathError(`Fuera de las carpetas habilitadas: ${input}`);
  }
  if (isSecretFile(real)) {
    throw new PathError(`Archivo sensible bloqueado: ${basename(real)}`);
  }
  if (options.write && real.split(sep).includes('.git')) {
    throw new PathError('No se escribe dentro de .git');
  }
  return real;
}

/** Ruta para mostrar: relativa a su carpeta habilitada, con `/`. */
export function displayPath(real: string): string {
  const root = config.roots.find((item) => isInside(item, real));
  if (!root) {
    return real;
  }
  const rel = relative(root, real).split(sep).join('/');
  return config.roots.length > 1 ? `${basename(root)}/${rel}` : rel || '.';
}
