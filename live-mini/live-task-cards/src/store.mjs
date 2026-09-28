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

/** Official SDK conditional registry writes. Pure mutations may be re-evaluated. */
export class BlobStore {
  constructor({token,pathname,maxRetries=12,getImpl,putImpl,isPreconditionFailed,timeoutMs=10_000}={}) {
    this.token=token;this.pathname=String(pathname||'').replace(/^\/+/, '');
    this.maxRetries=maxRetries;this.getImpl=getImpl;this.putImpl=putImpl;
    this.isPreconditionFailed=isPreconditionFailed;this.timeoutMs=timeoutMs;
    assert(this.pathname,'CONFIG_ERROR','BLOB_PATHNAME is missing.',503);
    assert(this.token||getImpl,'CONFIG_ERROR','Blob credentials are missing.',503);
    assert(Number.isInteger(maxRetries)&&maxRetries>0&&maxRetries<=20,'CONFIG_ERROR','Invalid CAS budget.',503);
  }
  async sdk(){return this._sdk??=await import('./blob-sdk.mjs');}
  async streamToText(stream,signal=AbortSignal.timeout(this.timeoutMs)) {
    const bounded=bytes=>{assert(bytes<=3_000_000,'STORE_FULL','Registry exceeds the read bound.',503);};
    if(typeof stream==='string'||Buffer.isBuffer(stream)){bounded(Buffer.byteLength(stream));return stream.toString();}
    assert(stream&&typeof stream.getReader==='function','STORE_UNAVAILABLE','Storage body is unavailable.',503);
    const reader=stream.getReader(),chunks=[];let bytes=0,abort;
    const cancelled=new Promise((_,reject)=>{abort=()=>{void reader.cancel().catch(()=>{});reject(new CardError('STORE_UNAVAILABLE','Storage read timed out.',503));};signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});
    try {
      for(;;){const {done,value}=await Promise.race([reader.read(),cancelled]);if(done)break;const chunk=Buffer.from(value);bytes+=chunk.length;bounded(bytes);chunks.push(chunk);}
      return Buffer.concat(chunks).toString('utf8');
    } catch(e){void reader.cancel().catch(()=>{});throw e;}
    finally{signal.removeEventListener('abort',abort);reader.releaseLock();}
  }
  async readRaw(){
    try{
      const get=this.getImpl??(await this.sdk()).get;
      const signal=AbortSignal.timeout(this.timeoutMs);
      const result=await get(this.pathname,{access:'private',useCache:false,token:this.token,abortSignal:signal});
      // The pinned official SDK returns null only for an actual 404.
      if(result===null)return null;
      assert(result?.statusCode===200,'STORE_UNAVAILABLE','Storage returned an unexpected response.',503);
      assert(!(result.blob?.size>3_000_000),'STORE_FULL','Registry exceeds the read bound.',503);
      const raw=await this.streamToText(result.stream,signal);
      assert(raw.length>0,'STORE_CORRUPT','Existing registry is empty.',503);
      return {raw,etag:result.blob?.etag};
    }catch(e){if(e instanceof CardError)throw e;throw new CardError('STORE_UNAVAILABLE','Storage response unavailable; reconcile the original request identity.',503);}
  }
  async read(){const got=await this.readRaw();return decode(got?got.raw:null);}
  async put(raw, previous=null){
    assert(Buffer.byteLength(raw)<=3_000_000,'STORE_FULL','Registry exceeds the write bound.',503);
    const options={access:'private',allowOverwrite:previous!==null,addRandomSuffix:false,contentType:'application/json',cacheControlMaxAge:60,token:this.token,abortSignal:AbortSignal.timeout(this.timeoutMs)};
    if(previous!==null){
      assert(typeof previous.etag==='string'&&/^"[^"\x00-\x20\x7f]+"$/.test(previous.etag),'STORE_VALIDATOR_REQUIRED','Existing registry needs its original strong validator.',503);
      options.ifMatch=previous.etag;
    }
    try{await (this.putImpl??(await this.sdk()).put)(this.pathname,raw,options);return true;}
    catch(e){
      const conflict=this.isPreconditionFailed?this.isPreconditionFailed(e):e instanceof (await this.sdk()).BlobPreconditionFailedError;
      if(conflict)return false;
      // SDK 2.8.0 has no typed AlreadyExists error. Do not guess a code/message.
      // A create-only failure (including lost response) may be reconciled by an
      // uncached read. The next pure mutation retains its original request ID.
      if(previous===null){const observed=await this.readRaw();if(observed){decode(observed.raw);return false;}}
      throw new CardError('STORE_UNAVAILABLE','Storage response unavailable; reconcile the original request identity.',503);
    }
  }
  async transaction(change){
    for(let attempt=0;attempt<this.maxRetries;attempt++){
      const got=await this.readRaw(),state=decode(got?got.raw:null),result=change(state);
      assert(!(result instanceof Promise),'INVALID_TRANSACTION','Transactions must be synchronous and side-effect free.',500);
      state.version++;
      if(await this.put(encode(state),got))return result;
      await sleep(Math.min(200,10*2**attempt));
    }
    throw new CardError('STORE_BUSY','Concurrent writes exhausted the CAS budget; reconcile the original request.',503);
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
