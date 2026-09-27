import { loadConfig } from './src/config.mjs';
import { makeStore } from './src/store.mjs';
import { CardService } from './src/service.mjs';
import { createHandler } from './src/http.mjs';
let handler;
export default async function main(req, res) {
  try {
    if (!handler) {
      const config = loadConfig({ ...process.env, VERCEL: '1' });
      handler = createHandler(new CardService(makeStore(config), config), config);
    }
    await handler(req, res);
  } catch {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ error: { code: 'CONFIG_ERROR', message: 'Card host is not configured.' } }));
  }
}
