import { randomBytes } from 'node:crypto';
process.env.PUBLIC_BASE_URL = `http://127.0.0.1:${process.env.PORT || 3000}`;
process.env.PUBLISHER_TOKEN = randomBytes(32).toString('hex');
process.env.VIEW_SIGNING_SECRET = randomBytes(32).toString('hex');
process.env.STORE = 'file'; process.env.DATA_FILE = '.data/preview.json';
process.env.ENABLE_DEMOS = 'true'; process.env.HOST = '127.0.0.1';
if (process.env.VERCEL || process.env.NODE_ENV === 'production') throw new Error('Preview is local only.');
await import('../server.mjs');
