import { resolve } from 'node:path';
import { assert } from './errors.mjs';

export function loadConfig(env = process.env) {
  const production = env.VERCEL === '1' || env.NODE_ENV === 'production';
  const base = new URL(env.PUBLIC_BASE_URL || 'http://127.0.0.1:3000');
  assert(!base.username && !base.password && base.pathname === '/' && !base.search && !base.hash,
    'CONFIG_ERROR', 'PUBLIC_BASE_URL must be an origin, without a path, query or credentials.', 503);
  assert(base.protocol === 'https:' || (!production && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)),
    'CONFIG_ERROR', 'Use HTTPS in production; HTTP is allowed only for local development.', 503);
  const publisherToken = env.PUBLISHER_TOKEN || '';
  const viewSecret = env.VIEW_SIGNING_SECRET || '';
  for (const [k, v] of [['PUBLISHER_TOKEN', publisherToken], ['VIEW_SIGNING_SECRET', viewSecret]]) {
    assert(v.length >= 32 && !v.startsWith('replace-'), 'CONFIG_ERROR', `${k} needs a generated secret of at least 32 characters.`, 503);
  }
  assert(publisherToken !== viewSecret, 'CONFIG_ERROR', 'Writer and view secrets must be different.', 503);
  const store = env.STORE || 'file';
  assert(['file', 'redis', 'blob'].includes(store), 'CONFIG_ERROR', 'STORE must be file, redis, or blob.', 503);
  assert(!production || store === 'redis' || store === 'blob',
    'CONFIG_ERROR', 'Production requires durable redis or blob storage; local files are development-only.', 503);
  const archiveDays = Number(env.ARCHIVE_DAYS || 30);
  const maxArchived = Number(env.MAX_ARCHIVED_CARDS || 100);
  assert(Number.isInteger(archiveDays) && archiveDays >= 1 && archiveDays <= 365,
    'CONFIG_ERROR', 'ARCHIVE_DAYS must be 1–365.', 503);
  assert(Number.isInteger(maxArchived) && maxArchived >= 10 && maxArchived <= 500,
    'CONFIG_ERROR', 'MAX_ARCHIVED_CARDS must be 10–500.', 503);
  const redisUrl = env.UPSTASH_REDIS_REST_URL || '';
  if (store === 'redis') {
    const u = new URL(redisUrl);
    assert(u.protocol === 'https:' && !u.username && !u.password && !u.search && !u.hash,
      'CONFIG_ERROR', 'Redis REST endpoint must be HTTPS without credentials or query.', 503);
    assert(env.UPSTASH_REDIS_REST_TOKEN, 'CONFIG_ERROR', 'Redis REST token is missing.', 503);
  }
  const blobToken = env.BLOB_READ_WRITE_TOKEN || '';
  if (store === 'blob') {
    assert(blobToken.startsWith('vercel_blob_rw_'), 'CONFIG_ERROR', 'BLOB_READ_WRITE_TOKEN is missing or invalid.', 503);
  }
  // Prefer BLOB_PATHNAME; accept legacy BLOB_PATH; fall back to REDIS_KEY.json for photon installs.
  const blobPath = env.BLOB_PATHNAME || env.BLOB_PATH
    || (env.REDIS_KEY ? `${env.REDIS_KEY}.json` : 'live-task-cards:v1:default.json');
  return {
    production, baseUrl: base.origin, publisherToken, viewSecret, store,
    dataFile: resolve(env.DATA_FILE || '.data/cards.json'), archiveDays, maxArchived,
    redisUrl: redisUrl.replace(/\/$/, ''), redisToken: env.UPSTASH_REDIS_REST_TOKEN,
    redisKey: env.REDIS_KEY || 'live-task-cards:v1:default',
    blobToken,
    blobPath,
    demos: env.ENABLE_DEMOS === 'true',
  };
}
