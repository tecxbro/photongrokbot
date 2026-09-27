import { createServer } from 'node:http';
import { loadConfig } from './src/config.mjs';
import { makeStore } from './src/store.mjs';
import { CardService } from './src/service.mjs';
import { createHandler } from './src/http.mjs';
const config = loadConfig();
const service = new CardService(makeStore(config), config);
const server = createServer(createHandler(service, config));
server.requestTimeout = 15000;
server.headersTimeout = 16000;
server.listen(Number(process.env.PORT || 3000), process.env.HOST || '127.0.0.1', () => {
  console.log(`Live task card host listening on port ${server.address().port}. No iMessage connection started.`);
});
for (const event of ['SIGINT', 'SIGTERM']) process.once(event, () => server.close(() => process.exit(0)));
