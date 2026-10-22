import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { AuthService, AuthServiceError } from './service.js';

const loginSchema = z.object({
  username: z.string().min(1).max(256),
  password: z.string().min(1).max(1024),
}).strict();

function readBearer(header: string | undefined): string | null {
  const match = header ? /^Bearer\s+(\S+)$/i.exec(header.trim()) : null;
  return match?.[1] ?? null;
}

function errorResponse(error: unknown, c: Context) {
  if (error instanceof AuthServiceError) return c.json({ error: error.message }, error.status);
  return c.json({ error: 'Internal Server Error' }, 500);
}

/** Rutas de sesión del workspace y contrato de introspección consumido por Agent Runtime. */
export function createAuthRoutes(auth: AuthService): Hono {
  const routes = new Hono();

  routes.post('/login', async (c) => {
    let input: unknown;
    try {
      input = await c.req.json();
    } catch {
      return c.json({ error: 'Expected a JSON request body' }, 400);
    }
    const parsed = loginSchema.safeParse(input);
    if (!parsed.success) return c.json({ error: 'Invalid login request' }, 400);

    try {
      return c.json(auth.login(parsed.data.username, parsed.data.password));
    } catch (error) {
      return errorResponse(error, c);
    }
  });

  // Agent Runtime forwards the host-issued Bearer here and maps these fields to its Principal.
  routes.get('/me', (c) => {
    const token = readBearer(c.req.header('Authorization'));
    if (!token) return c.json({ error: 'Unauthorized' }, 401);
    try {
      return c.json(auth.resolve(token));
    } catch (error) {
      return errorResponse(error, c);
    }
  });

  routes.post('/logout', (c) => {
    const token = readBearer(c.req.header('Authorization'));
    if (!token) return c.json({ error: 'Unauthorized' }, 401);
    try {
      auth.revoke(token);
      return c.body(null, 204);
    } catch (error) {
      return errorResponse(error, c);
    }
  });

  return routes;
}
