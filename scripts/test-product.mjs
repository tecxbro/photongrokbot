#!/usr/bin/env node
/** Each test process gets a distinct explicitly guarded synthetic instance. */
import { readdir, mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url));
const bun=process.env.PHOTON_TEST_BUN||'bun';
const mode=process.argv[2]||'all';
if(!['all','bridge','host'].includes(mode))throw new Error('Expected all, bridge or host');
const results=[];
async function execute(command,args,cwd,env={}){
 return await new Promise(resolve=>{
  const child=spawn(command,args,{cwd,env:{...process.env,...env},stdio:['ignore','pipe','pipe']});
  let output='';let timer;
  for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{if(output.length<1_000_000)output+=chunk.toString();});
  timer=setTimeout(()=>{child.kill('SIGTERM');setTimeout(()=>child.kill('SIGKILL'),3000).unref();},120_000);
  child.once('error',()=>{clearTimeout(timer);resolve({exit:127,output:'COMMAND_UNAVAILABLE'});});
  child.once('exit',code=>{clearTimeout(timer);resolve({exit:code??1,output});});
 });
}
async function run(label,command,args,cwd,env){const result=await execute(command,args,cwd,env);results.push({label,...result});console.log(`${result.exit===0?'PASS':'FAIL'} ${label} (exit ${result.exit})`);if(result.exit)console.log(result.output);return result.exit===0;}
async function files(dir){const found=[];for(const item of await readdir(dir,{withFileTypes:true})){const path=join(dir,item.name);if(item.isDirectory())found.push(...await files(path));else if(item.name.endsWith('.test.ts'))found.push(path);}return found.sort();}
if(mode!=='host'){
 await run('bridge frozen install',bun,['install','--frozen-lockfile'],join(root,'bridge'));
 const tests=await files(join(root,'bridge/src'));
 const queue=[...tests];
 // Independent files run in parallel; race suites themselves start real processes.
 await Promise.all(Array.from({length:Math.min(3,tests.length)},async()=>{
  while(queue.length){const file=queue.shift();const dir=await mkdtemp(join(await realpath(tmpdir()),'photon-suite-'));
   try{
    await mkdir(join(dir,'secrets'),{mode:0o700});
    await writeFile(join(dir,'instance.json'),JSON.stringify({version:1,installationId:randomUUID()}),{mode:0o600});
    await run(relative(root,file),bun,['test',file],join(root,'bridge'),{PHOTON_TEST_MODE:'1',PHOTON_INSTANCE_DIR:dir,NODE_ENV:'test'});
   }finally{await rm(dir,{recursive:true,force:true});}
  }
 }));
 await run('bridge typecheck',bun,['run','typecheck'],join(root,'bridge'));
}
if(mode!=='bridge'){
 const host=join(root,'live-mini/live-task-cards');
 for(const [label,args]of [['host frozen install',['ci']],['host tests',['test']],['host skill tests',['run','test:skill']],['host check',['run','check']],['host build',['run','build']]])await run(label,'npm',args,host);
 const helper=join(root,'live-mini/runtime/live-card-milestones.test.mjs');
 try{await run('Live Mini helper',process.execPath,['--test',helper],root,{PHOTON_TEST_MODE:'1',NODE_ENV:'test'});}catch{throw new Error('LIVE_HELPER_TEST_REQUIRED');}
}
if(process.env.PHOTON_TEST_REPORT){const sha=await execute('git',['rev-parse','HEAD'],root);await writeFile(process.env.PHOTON_TEST_REPORT,JSON.stringify({sha:sha.output.trim(),node:process.version,results},null,2));}
process.exitCode=results.some(r=>r.exit!==0)?1:0;
console.log(`Product check: ${results.length} commands, ${results.filter(r=>r.exit!==0).length} failed.`);
