import { writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
const value = `PORT=3000\nHOST=127.0.0.1\nPUBLIC_BASE_URL=http://127.0.0.1:3000\nPUBLISHER_TOKEN=${randomBytes(32).toString('hex')}\nVIEW_SIGNING_SECRET=${randomBytes(32).toString('hex')}\nSTORE=file\nDATA_FILE=.data/cards.json\nENABLE_DEMOS=true\nARCHIVE_DAYS=30\nMAX_ARCHIVED_CARDS=100\n`;
try {
  await writeFile('.env', value, { flag: 'wx', mode: 0o600 });
  console.log('Created owner-only .env for local development. Existing configuration is never overwritten.');
} catch (error) {
  if (error.code === 'EEXIST') console.log('.env already exists; kept unchanged.');
  else throw error;
}
