import { createHash, timingSafeEqual } from 'node:crypto';
import type { AuthService } from './service.js';

function sameSecret(received: string | undefined, expectedSecret: string): boolean {
  const expected = createHash('sha256').update(expectedSecret).digest();
  const actual = createHash('sha256').update(received ?? '').digest();
  return timingSafeEqual(expected, actual);
}

function readBearer(header: string | undefined): string | null {
  const match = header ? /^Bearer\s+(\S+)$/i.exec(header.trim()) : null;
  return match?.[1] ?? null;
}

/** Requires both the MCP service secret and an active, identified workspace user session. */
export function isAuthorizedMcpRequest(
  serviceTokenHeader: string | undefined,
  authorizationHeader: string | undefined,
  serviceToken: string,
  auth: AuthService,
): boolean {
  if (!sameSecret(serviceTokenHeader, serviceToken)) return false;

  const userToken = readBearer(authorizationHeader);
  if (!userToken) return false;
  try {
    auth.resolve(userToken);
    return true;
  } catch {
    return false;
  }
}
