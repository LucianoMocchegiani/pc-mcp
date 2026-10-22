import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { PcMcpAuthConfig } from '../config.js';

export const AUTH_SESSION_TTL_SECONDS = 8 * 60 * 60;
const AUTH_SESSION_TTL_MS = AUTH_SESSION_TTL_SECONDS * 1000;
const AUTH_SESSION_MAX_ENTRIES = 1024;

export type Principal = PcMcpAuthConfig['principal'];

export class AuthServiceError extends Error {
  constructor(readonly status: 401 | 503, message: string) {
    super(message);
    this.name = 'AuthServiceError';
  }
}

export type OwnerSession = {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  user: Principal;
};

type SessionEntry = { principal: Principal; expiresAt: number };

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

function safeEqual(left: string, right: string): boolean {
  return timingSafeEqual(digest(left), digest(right));
}

/**
 * Login local del workspace y endpoint de introspección para Agent Runtime.
 * Los tokens son opacos, aleatorios, de vida limitada y las sesiones viven solo en memoria.
 */
export class AuthService {
  private readonly sessions = new Map<string, SessionEntry>();

  constructor(private readonly credentials: PcMcpAuthConfig | null) {}

  login(username: string, password: string): OwnerSession {
    if (!this.credentials) {
      throw new AuthServiceError(503, 'Workspace owner authentication is not configured');
    }

    const usernameMatches = safeEqual(username, this.credentials.username);
    const passwordMatches = safeEqual(password, this.credentials.password);
    if (!usernameMatches || !passwordMatches) {
      throw new AuthServiceError(401, 'Invalid credentials');
    }

    this.removeExpired();
    while (this.sessions.size >= AUTH_SESSION_MAX_ENTRIES) {
      const oldest = this.sessions.keys().next().value;
      if (oldest === undefined) break;
      this.sessions.delete(oldest);
    }

    const accessToken = randomBytes(32).toString('base64url');
    this.sessions.set(digest(accessToken).toString('hex'), {
      principal: this.credentials.principal,
      expiresAt: Date.now() + AUTH_SESSION_TTL_MS,
    });

    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: AUTH_SESSION_TTL_SECONDS,
      user: this.credentials.principal,
    };
  }

  resolve(token: string): Principal {
    const key = digest(token).toString('hex');
    const session = this.sessions.get(key);
    if (!session || session.expiresAt <= Date.now()) {
      if (session) this.sessions.delete(key);
      throw new AuthServiceError(401, 'Unauthorized');
    }
    return session.principal;
  }

  revoke(token: string): void {
    const key = digest(token).toString('hex');
    if (!this.sessions.delete(key)) {
      throw new AuthServiceError(401, 'Unauthorized');
    }
  }

  private removeExpired(): void {
    const now = Date.now();
    for (const [key, session] of this.sessions) {
      if (session.expiresAt <= now) this.sessions.delete(key);
    }
  }
}
