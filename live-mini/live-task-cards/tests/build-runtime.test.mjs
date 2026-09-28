import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,cp,rm,writeFile,readFile } from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
test('B01 B02 deployed artifact imports bundled SDK and serves local assets without checkout or credentials',async()=>{
 const root=new URL('../',import.meta.url), env={...process.env};
 for(const key of Object.keys(env))if(/BLOB|VERCEL|PUBLISHER|VIEW_SIGNING/.test(key))delete env[key];
 await exec(process.execPath,['scripts/build.mjs'],{cwd:root,env});
 const temp=await mkdtemp(join(tmpdir(),'photon-built-'));
 try{
  await cp(new URL('../.vercel/output/functions/index.func/',import.meta.url),temp,{recursive:true});
  await writeFile(join(temp,'smoke.mjs'),`
    import assert from 'node:assert/strict';
    import {createServer} from 'node:http';
    const sdk=await import('./src/blob-sdk.mjs');assert.equal(typeof sdk.get,'function');assert.equal(typeof sdk.put,'function');
    process.env.STORE='blob';process.env.BLOB_READ_WRITE_TOKEN='vercel_blob_rw_synthetic_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
    process.env.PUBLISHER_TOKEN='p'.repeat(40);process.env.VIEW_SIGNING_SECRET='v'.repeat(40);process.env.PUBLIC_BASE_URL='https://synthetic.example';
    const handler=(await import('./index.mjs')).default;
    const server=createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));
    try{const origin='http://127.0.0.1:'+server.address().port;
      for(const path of ['/health','/matrix/square-animation.js']){const r=await fetch(origin+path);assert.equal(r.status,200,path);assert((await r.text()).length>0);}
    }finally{await new Promise(r=>server.close(r));}
    console.log('BUILT_ARTIFACT_OK');
  `);
  const result=await exec(process.execPath,['smoke.mjs'],{cwd:temp,env});assert.match(result.stdout,/BUILT_ARTIFACT_OK/);
  const bundled=await readFile(join(temp,'src/blob-sdk.mjs'),'utf8');assert(!bundled.includes("from '@vercel/blob'"));
 }finally{await rm(temp,{recursive:true,force:true});}
});
