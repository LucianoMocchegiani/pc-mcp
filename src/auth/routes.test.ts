import assert from 'node:assert/strict';
import test from 'node:test';
import { Hono } from 'hono';
import type { PcMcpAuthConfig } from '../config.js';
import { AuthService } from './service.js';
import { createAuthRoutes } from './routes.js';

const owner: PcMcpAuthConfig = {
  username: 'workspace-owner',
  password: 'a-secure-test-password',
  principal: { userId: 'owner-123', email: 'owner@example.test', name: 'Workspace Owner' },
};

function createTestApp(authConfig: PcMcpAuthConfig | null = owner) {
  const app = new Hono();
  app.route('/auth', createAuthRoutes(new AuthService(authConfig)));
  return app;
}

test('owner login returns an opaque Bearer that resolves to the stable principal and can be revoked', async () => {
  const app = createTestApp();
  const login = await app.request('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: owner.username, password: owner.password }),
  });
  assert.equal(login.status, 200);
  const session = await login.json() as {
    accessToken: string;
    tokenType: string;
    expiresIn: number;
    user: PcMcpAuthConfig['principal'];
  };
  assert.equal(session.tokenType, 'Bearer');
  assert.equal(session.expiresIn, 8 * 60 * 60);
  assert.match(session.accessToken, /^[A-Za-z0-9_-]{40,}$/);
  assert.deepEqual(session.user, owner.principal);

  const identity = await app.request('/auth/me', {
    headers: { Authorization: `Bearer ${session.accessToken}` },
  });
  assert.equal(identity.status, 200);
  assert.deepEqual(await identity.json(), owner.principal);

  const logout = await app.request('/auth/logout', {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.accessToken}` },
  });
  assert.equal(logout.status, 204);

  const afterLogout = await app.request('/auth/me', {
    headers: { Authorization: `Bearer ${session.accessToken}` },
  });
  assert.equal(afterLogout.status, 401);
});

test('invalid credentials and missing bearer are rejected', async () => {
  const app = createTestApp();
  const login = await app.request('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: owner.username, password: 'wrong-password' }),
  });
  assert.equal(login.status, 401);
  assert.deepEqual(await login.json(), { error: 'Invalid credentials' });

  const identity = await app.request('/auth/me');
  assert.equal(identity.status, 401);
});

test('login reports an unavailable auth provider when owner credentials are not configured', async () => {
  const app = createTestApp(null);
  const response = await app.request('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'owner', password: 'password' }),
  });
  assert.equal(response.status, 503);
});

test('malformed login requests are rejected without reaching the auth service', async () => {
  const app = createTestApp();
  const response = await app.request('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{',
  });
  assert.equal(response.status, 400);
});
