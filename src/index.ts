import { serve } from '@hono/node-server';
import { config } from './config.js';
import { createApp } from './server.js';

const app = createApp();

serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
  console.log(`pc-mcp listening on ${config.host}:${info.port} (${config.readOnly ? 'solo lectura' : 'lectura y escritura'})`);
  for (const root of config.roots) {
    console.log(`  root: ${root}`);
  }
});
