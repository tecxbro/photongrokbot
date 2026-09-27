import { mkdir, readFile, rename, rm, open } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { CardError, assert } from './errors.mjs';
import { emptyState, checkState } from './model.mjs';

function decode(raw) {
  try { return checkState(raw ? JSON.parse(raw) : emptyState()); }
  catch (e) { if (e instanceof CardError) throw e;
    throw new CardError('STORE_CORRUPT', 'Cannot parse the registry. Preserve the file/key for recovery.', 503); }
}
function encode(state) {
  checkState(state);
  const raw = JSON.stringify(state);
  assert(Buffer.byteLength(raw) <= 3_000_000, 'STORE_FULL', 'Registry exceeds its V1 bound; archive policy needs review.', 503);
  return raw;
}

/** A local, cross-process lock + atomic rename. Never use this on Vercel. */
export class FileStore {
  constructor(path, { lockTimeoutMs = 5000 } = {}) { this.path = path; this.lock = `${path}.lock`; this.lockTimeoutMs = lockTimeoutMs; }
  async readRaw() {
    try { return await readFile(this.path, 'utf8'); }
    catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  }
  async read() { return decode(await this.readRaw()); }
  async transaction(change) {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const deadline = Date.now() + this.lockTimeoutMs;
    for (;;) {
      try { await mkdir(this.lock, { mode: 0o700 }); break; }
      catch (e) {
        if (e.code !== 'EEXIST') throw e;
        if (Date.now() >= deadline) throw new CardError('STORE_BUSY', 'Registry is locked. A crashed local owner needs explicit recovery.', 503);
        await sleep(10 + Math.random() * 20);
      }
    }
    let tmp;
    try {
      const state = await this.read();
      const result = change(state);
      assert(!(result instanceof Promise), 'INVALID_TRANSACTION', 'Transactions must not perform asynchronous side effects.', 500);
      state.version++;
      const raw = encode(state);
      tmp = `${this.path}.${randomUUID()}.tmp`;
      const file = await open(tmp, 'wx', 0o600);
      try { await file.writeFile(raw); await file.sync(); } finally { await file.close(); }
      await rename(tmp, this.path);
      const directory = await open(dirname(this.path), 'r');
      try { await directory.sync(); } finally { await directory.close(); }
      return result;
    } finally {
      if (tmp) await rm(tmp, { force: true });
      await rm(this.lock, { recursive: true, force: true });
    }
  }
}

// One atomic compare-and-swap; never substitute GET + SET or a non-atomic pipeline.
export const CAS_SCRIPT = `
local previous = redis.call('GET', KEYS[1])
if (not previous and ARGV[1] == '') or previous == ARGV[1] then
  redis.call('SET', KEYS[1], ARGV[2])
  return 1
end
return 0
`;

/** Small single-setup V1 store. Bounded history keeps the one-document CAS manageable. */
export class RedisStore {
  constructor({ url, token, key, fetchImpl = fetch, maxRetries = 12 }) {
    this.url = url; this.token = token; this.key = key; this.fetch = fetchImpl; this.maxRetries = maxRetries;
  }
  async command(args) {
    let r;
    try {
      r = await this.fetch(this.url, { method: 'POST', headers: {
        Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json',
      }, body: JSON.stringify(args), signal: AbortSignal.timeout(10_000), redirect: 'error' });
    } catch {
      // The write may have committed. Callers reconcile using the same request ID.
      throw new CardError('STORE_UNAVAILABLE', 'Storage response unavailable; reconcile before issuing different work.', 503);
    }
    assert(r.ok, 'STORE_UNAVAILABLE', 'Storage rejected the request.', 503);
    const body = await r.json();
    assert(!body.error && Object.hasOwn(body, 'result'), 'STORE_UNAVAILABLE', 'Storage command failed.', 503);
    return body.result;
  }
  async read() { return decode(await this.command(['GET', this.key])); }
  async transaction(change) {
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      const old = await this.command(['GET', this.key]);
      const state = decode(old);
      const result = change(state);
      assert(!(result instanceof Promise), 'INVALID_TRANSACTION', 'Transactions must be synchronous and side-effect free.', 500);
      state.version++;
      const changed = encode(state);
      const ok = await this.command(['EVAL', CAS_SCRIPT, '1', this.key, old ?? '', changed]);
      if (ok === 1) return result;
      await sleep(Math.min(200, 10 * 2 ** attempt) + Math.random() * 15);
    }
    throw new CardError('STORE_BUSY', 'Concurrent writes exhausted the retry budget. Read current state before retrying.', 503);
  }
}

/**
 * Durable single-document CAS on private Vercel Blob.
 * Uses get/put (protocol-compatible with @vercel/blob >=2.3) with useCache:false and ifMatch ETags.
 * Inject getImpl/putImpl/isPreconditionFailed for unit tests.
 */
export class BlobStore {
  constructor({
    token,
    pathname,
    maxRetries = 12,
    getImpl,
    putImpl,
    isPreconditionFailed,
  } = {}) {
    this.token = token;
    this.pathname = String(pathname || '').replace(/^\/+/, '');
    this.maxRetries = maxRetries;
    this.getImpl = getImpl;
    this.putImpl = putImpl;
    this.isPreconditionFailed = isPreconditionFailed || ((err) => {
      const name = err?.name || err?.constructor?.name || '';
      return name === 'BlobPreconditionFailedError' || err?.code === 'precondition_failed' || err?.status === 412;
    });
    assert(this.pathname, 'CONFIG_ERROR', 'BLOB_PATHNAME is missing.', 503);
    assert(this.token || getImpl, 'CONFIG_ERROR', 'BLOB_READ_WRITE_TOKEN is missing.', 503);
  }

  async streamToText(stream) {
    if (stream == null) return null;
    if (typeof stream === 'string') return stream;
    if (Buffer.isBuffer(stream)) return stream.toString('utf8');
    if (typeof stream.getReader === 'function') {
      const reader = stream.getReader();
      const chunks = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(typeof value === 'string' ? Buffer.from(value) : Buffer.from(value));
      }
      return Buffer.concat(chunks).toString('utf8');
    }
    // Node.js Readable / async iterable
    if (typeof stream[Symbol.asyncIterator] === 'function') {
      const chunks = [];
      for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      return Buffer.concat(chunks).toString('utf8');
    }
    throw new CardError('STORE_UNAVAILABLE', 'Storage response unavailable; reconcile before issuing different work.', 503);
  }

  async sdk() {
    if (!this._sdk) this._sdk = await import('./vercel-blob-lite.mjs');
    return this._sdk;
  }

  async readRaw() {
    try {
      let result;
      if (this.getImpl) {
        result = await this.getImpl(this.pathname, { access: 'private', useCache: false, token: this.token });
      } else {
        const { get } = await this.sdk();
        result = await get(this.pathname, { access: 'private', useCache: false, token: this.token });
      }
      if (!result || result.statusCode === 404) return null;
      if (result.statusCode === 304) {
        // Unexpected without ifNoneMatch; treat as miss rather than empty registry.
        throw new CardError('STORE_UNAVAILABLE', 'Storage returned not-modified without a conditional request.', 503);
      }
      assert(result.statusCode === 200, 'STORE_UNAVAILABLE', 'Storage rejected the request.', 503);
      const raw = await this.streamToText(result.stream ?? result.body ?? result);
      const etag = result.blob?.etag || result.etag || null;
      return { raw, etag };
    } catch (e) {
      if (e instanceof CardError) throw e;
      throw new CardError('STORE_UNAVAILABLE', 'Storage response unavailable; reconcile before issuing different work.', 503);
    }
  }

  async read() {
    const got = await this.readRaw();
    return decode(got ? got.raw : null);
  }

  async put(raw, { etag } = {}) {
    const options = {
      access: 'private',
      allowOverwrite: true,
      contentType: 'application/json',
      cacheControlMaxAge: 60,
      token: this.token,
      addRandomSuffix: false,
    };
    if (etag) options.ifMatch = etag;
    // First create (no blob yet): omit ifMatch so put can succeed without a prior ETag.
    try {
      if (this.putImpl) {
        await this.putImpl(this.pathname, raw, options);
      } else {
        const { put } = await this.sdk();
        await put(this.pathname, raw, options);
      }
      return true;
    } catch (e) {
      if (this.isPreconditionFailed(e)) return false;
      if (e instanceof CardError) throw e;
      throw new CardError('STORE_UNAVAILABLE', 'Storage response unavailable; reconcile before issuing different work.', 503);
    }
  }

  async transaction(change) {
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      const got = await this.readRaw();
      const old = got ? got.raw : null;
      const state = decode(old);
      const result = change(state);
      assert(!(result instanceof Promise), 'INVALID_TRANSACTION', 'Transactions must be synchronous and side-effect free.', 500);
      state.version++;
      const changed = encode(state);
      // Creating the first object: no etag. Overwrites: require ifMatch.
      const ok = await this.put(changed, { etag: got?.etag || undefined });
      if (ok) return result;
      await sleep(Math.min(200, 10 * 2 ** attempt) + Math.random() * 15);
    }
    throw new CardError('STORE_BUSY', 'Concurrent writes exhausted the retry budget. Read current state before retrying.', 503);
  }
}

export function makeStore(config) {
  if (config.store === 'redis') {
    return new RedisStore({ url: config.redisUrl, token: config.redisToken, key: config.redisKey });
  }
  if (config.store === 'blob') {
    return new BlobStore({ token: config.blobToken, pathname: config.blobPath });
  }
  return new FileStore(config.dataFile);
}
