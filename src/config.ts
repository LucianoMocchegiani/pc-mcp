import { realpathSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env ${name}`);
  }
  return value;
}

function parseRoots(raw: string): string[] {
  const roots = raw
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean);
  if (roots.length === 0) {
    throw new Error('PC_MCP_ROOTS must list at least one folder');
  }
  return roots.map((root) => {
    if (!isAbsolute(root)) {
      throw new Error(`PC_MCP_ROOTS entry must be absolute: ${root}`);
    }
    if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
      throw new Error(`PC_MCP_ROOTS entry is not a folder: ${root}`);
    }
    return realpathSync.native(root);
  });
}

function parseToken(raw: string): string {
  if (raw === 'replace-me' || raw.length < 24) {
    throw new Error('PC_MCP_TOKEN must be a random secret of at least 24 chars');
  }
  return raw;
}

function parsePort(raw: string | undefined): number {
  if (!raw?.trim()) {
    return 3020;
  }
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PC_MCP_PORT: ${raw}`);
  }
  return port;
}

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (!raw?.trim()) {
    return fallback;
  }
  const value = raw.trim().toLowerCase();
  if (value === 'true' || value === '1') {
    return true;
  }
  if (value === 'false' || value === '0') {
    return false;
  }
  throw new Error(`Invalid boolean env: ${raw}`);
}

export type PcMcpConfig = {
  /** Reales (symlinks resueltos). La primera es la base de las rutas relativas. */
  roots: string[];
  token: string;
  readOnly: boolean;
  braveSearchApiKey?: string;
  host: string;
  port: number;
};

export const config: PcMcpConfig = {
  roots: parseRoots(required('PC_MCP_ROOTS')),
  token: parseToken(required('PC_MCP_TOKEN')),
  readOnly: parseBool(process.env.PC_MCP_READ_ONLY, false),
  braveSearchApiKey: process.env.PC_MCP_BRAVE_API_KEY?.trim() || undefined,
  host: process.env.PC_MCP_HOST?.trim() || '127.0.0.1',
  port: parsePort(process.env.PC_MCP_PORT),
};
