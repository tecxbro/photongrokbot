import test from 'node:test';
import assert from 'node:assert/strict';
import { BlobPreconditionFailedError, BlobError } from '@vercel/blob';
import { BlobStore } from '../src/store.mjs';
import { CardService } from '../src/service.mjs';
import { config, payload } from './helpers.mjs';
import { emptyState } from '../src/model.mjs';

function boundary({ barrier=false }={}) {
  let raw=null, version=0, arrivals=0, release;
  const ready=new Promise(r=>release=r), calls=[];
  return {
    calls, get raw(){return raw;}, set raw(value){raw=value;},
    async get(path, opts) {
      assert.equal(opts.useCache,false);
      const snapshot=raw, etag=`"v${version}"`;
      if(barrier && arrivals++ < 2){if(arrivals===2)release();await ready;}
      return snapshot===null?null:{statusCode:200,stream:snapshot,blob:{etag}};
    },
    async put(path, body, opts) {
      calls.push(opts);
      if(raw!==null && opts.allowOverwrite===false)throw new BlobError('already exists');
      if(opts.ifMatch && opts.ifMatch!==`"v${version}"`)throw new BlobPreconditionFailedError();
      raw=body;version++;return {etag:`"v${version}"`};
    },
  };
}
function store(api, more={}){return new BlobStore({pathname:'registry.json',getImpl:api.get,putImpl:api.put,...more});}
test('L01 deterministic simultaneous absent reads preserve both slot claims',async()=>{
  const api=boundary({barrier:true}), b=await payload();
  const results=await Promise.all([0,1].map(i=>new CardService(store(api),config()).create({...b,requestId:`r-${i}`,taskId:`t-${i}`})));
  assert.equal(new Set(results.map(r=>r.slot)).size,2);
  assert.equal(Object.keys(JSON.parse(api.raw).cards).length,2);
  assert.equal(api.calls[0].allowOverwrite,false);
});
for(const etag of [undefined,'','W/"abc"','abc','"bad\nvalue"'])test(`L02 reject unusable validator ${JSON.stringify(etag)}`,async()=>{
 let writes=0;
 const s=store({get:async()=>({statusCode:200,stream:JSON.stringify(emptyState()),blob:{etag}}),put:async()=>writes++});
 await assert.rejects(s.transaction(()=>null),{code:'STORE_VALIDATOR_REQUIRED'});assert.equal(writes,0);
});
test('L03 existing ETag conflict bounded reread preserves concurrent state',async()=>{
 const api=boundary(), base=await payload(), service=new CardService(store(api),config());await service.create(base);
 let once=true;
 const original=api.put;api.put=async(...args)=>{if(once){once=false;throw new BlobPreconditionFailedError();}return original(...args);};
 await new CardService(store(api),config()).create({...base,requestId:'r-second',taskId:'t-second'});
 assert.equal(Object.keys(JSON.parse(api.raw).cards).length,2);
 const forever=store({get:api.get,put:async()=>{throw new BlobPreconditionFailedError();}},{maxRetries:2});
 await assert.rejects(forever.transaction(()=>null),{code:'STORE_BUSY'});
});
test('L04 timeout after commit reconciles original request identity',async()=>{
 const api=boundary(), original=api.put;let once=true;
 api.put=async(...args)=>{const r=await original(...args);if(once){once=false;throw new Error('token-seeded-private');}return r;};
 const svc=new CardService(store(api),config()), body=await payload();
 let first;try{first=await svc.create(body);}catch(e){assert.equal(e.code,'STORE_UNAVAILABLE');assert(!e.message.includes('token-seeded-private'));}
 const result=await svc.create(body);if(first)assert.equal(result.id,first.id);
 assert.equal(Object.keys(JSON.parse(api.raw).cards).length,1);
});
for(const response of [{statusCode:304},{statusCode:500},{statusCode:200,stream:'',blob:{etag:'"x"'}},{statusCode:200,stream:'{bad',blob:{etag:'"x"'}}])test('L05 corrupt/cache/error response fails closed '+response.statusCode+response.stream,async()=>{
 let writes=0;const s=store({get:async()=>response,put:async()=>writes++});await assert.rejects(s.transaction(()=>null));assert.equal(writes,0);
});
test('L06 bounds streaming read and write; cancellation does not print secrets',async()=>{
 let cancelled=false,writes=0,chunks=0;
 const stream=new ReadableStream({pull(c){if(chunks++<5)c.enqueue(new Uint8Array(1_000_001));else c.close();},cancel(){cancelled=true;}});
 const s=store({get:async()=>({statusCode:200,stream,blob:{etag:'"x"'}}),put:async()=>writes++});
 await assert.rejects(s.read(),{code:'STORE_FULL'});assert(cancelled);assert.equal(writes,0);
 await assert.rejects(s.put('x'.repeat(3_000_001),null),{code:'STORE_FULL'});
});

test('L04 existing conditional write lost response is uncertain until same request replay',async()=>{
 const api=boundary(), body=await payload(),svc=new CardService(store(api),config());await svc.create(body);
 const original=api.put;let calls=0;api.put=async(...args)=>{calls++;await original(...args);throw new Error('secret k=do-not-print');};
 const next={...body,requestId:'r-next',taskId:'t-next'};
 await assert.rejects(new CardService(store(api),config()).create(next),e=>e.code==='STORE_UNAVAILABLE'&&!e.message.includes('do-not-print'));
 assert.equal(calls,1);api.put=original;
 await new CardService(store(api),config()).create(next);assert.equal(Object.keys(JSON.parse(api.raw).cards).length,2);
});
