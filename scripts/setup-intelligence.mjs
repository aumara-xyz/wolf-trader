#!/usr/bin/env node
/** Free, pinned model provisioning. Nothing is installed in the Git checkout or donor repos. */
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, readdir, stat, statfs, rename, rm, mkdtemp, copyFile } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PINS, providerRuntimeDir, createProviderRegistry } from '../packages/providers/index.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const flags = new Set();
let runtime = providerRuntimeDir(), layaImport;
for (let i=0;i<args.length;i++) {
  const a=args[i];
  if (['--runtime-dir','--laya-model-dir'].includes(a)) {
    if (!args[i+1] || args[i+1].startsWith('--')) throw Error(`${a} requires a directory.`);
    if (a==='--runtime-dir') runtime=path.resolve(args[++i]); else layaImport=path.resolve(args[++i]);
  } else if (['--python','--kronos','--laya','--dexter','--nautilus','--verify','--help'].includes(a)) flags.add(a);
  else throw Error(`Unknown setup option: ${a}`);
}
if (flags.has('--help')) {
  console.log('node scripts/setup-intelligence.mjs [--kronos --laya --dexter --nautilus] [--verify] [--runtime-dir DIR] [--laya-model-dir DIR]\nNo provider flags installs all four free local providers. Prerequisites: Node 22+, uv, Bun, Ollama. The default path is outside Git. Models total about 2.3 GB plus Python dependencies. No API keys or accounts are read. --verify runs real local inference with public Coinbase observations and a clearly marked classification fixture. Jev is a separately configured hosted API and is never called by setup.');
  process.exit(0);
}
const selected = ['--python','--kronos','--laya','--dexter','--nautilus'].some(f=>flags.has(f));
const wants = id => !selected || flags.has('--'+id);
const safeEnv = Object.fromEntries(['PATH','TMPDIR','LANG','SYSTEMROOT'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
safeEnv.OLLAMA_MODELS=path.join(runtime,'ollama-models');
safeEnv.OLLAMA_NO_CLOUD='1';
const sha = value => createHash('sha256').update(value).digest('hex');
async function exists(file) {try{await stat(file);return true;}catch{return false;}}
async function digest(file) { const h=createHash('sha256');for await(const chunk of createReadStream(file))h.update(chunk);return h.digest('hex'); }
async function valid(file, expected) {try{return (await stat(file)).size===expected.bytes && await digest(file)===expected.sha256;}catch{return false;}}
async function run(binary, argv, cwd=runtime, quiet=false) {
  return new Promise((resolve,reject)=>{
    const child=spawn(binary,argv,{cwd,env:safeEnv,stdio:quiet?['ignore','pipe','pipe']:'inherit'});
    let output=''; if(quiet){child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);}
    child.on('error',()=>reject(Error(`${binary} is unavailable. Install the official prerequisite and run setup again.`)));
    child.on('exit',code=>code===0?resolve(output.trim()):reject(Error(`${path.basename(binary)} failed with exit ${code}: ${output.slice(-500)}`)));
  });
}
async function binary(name, explicit, fallback) {
  const value=explicit || (fallback && await exists(fallback) ? fallback : name);
  await run(value,['--version'],runtime,true);return value;
}
async function download(url, target, expected) {
  if(await valid(target,expected)) return;
  await mkdir(path.dirname(target),{recursive:true});
  const disk=await statfs(path.dirname(target));
  if(disk.bavail*disk.bsize < expected.bytes+512_000_000)throw Error('Insufficient free space for '+path.basename(target));
  const response=await fetch(url,{signal:AbortSignal.timeout(30*60*1000)});
  if(!response.ok || !response.body)throw Error(`Public artifact download failed: HTTP ${response.status}`);
  const temporary=target+'.partial-'+process.pid;let size=0;const h=createHash('sha256');
  const check=new Transform({transform(chunk,encoding,cb){size+=chunk.length;if(size>expected.bytes)return cb(Error('Artifact exceeded its pinned size.'));h.update(chunk);cb(null,chunk);}});
  try {
    await pipeline(Readable.fromWeb(response.body),check,createWriteStream(temporary,{flags:'wx',mode:0o600}));
    if(size!==expected.bytes || h.digest('hex')!==expected.sha256)throw Error('Public artifact did not match its pinned digest.');
    await rename(temporary,target);
  } finally {await rm(temporary,{force:true});}
}
async function model(repo, revision, files, folder) {
  for(const [file,pin] of Object.entries(files)) await download(`https://huggingface.co/${repo}/resolve/${revision}/${file}`,path.join(folder,file),pin);
}
async function dexterManifest(source) {
  async function walk(dir){let files=[];for(const e of await readdir(path.join(source,dir),{withFileTypes:true})){if(e.isDirectory())files.push(...await walk(dir+'/'+e.name));else if(e.isFile())files.push(dir+'/'+e.name);else throw Error('Unexpected source symlink.');}return files;}
  const files={};for(const f of [...await walk('src'),'package.json','bun.lock','tsconfig.json','SOUL.md'].sort()) files[f]=await digest(path.join(source,f));
  if(sha(JSON.stringify(files))!==PINS.dexter.sourceManifestDigest)throw Error('Dexter source closure does not match the pinned revision.');
  return {revision:PINS.dexter.revision,files};
}
async function setupDexter() {
  const bun=await binary('bun',process.env.WOLF_BUN_PATH,path.join(homedir(),'.bun/bin/bun'));
  await binary('ollama',process.env.WOLF_OLLAMA_PATH,process.platform==='darwin'?'/opt/homebrew/bin/ollama':undefined);
  const source=path.join(runtime,'dexter');let manifest;
  try {manifest=await dexterManifest(source);}catch {
    // Never overwrite an altered installed source tree without the owner moving it aside.
    if(await exists(source))throw Error('An existing Dexter installation differs from the pin. Move that provider directory aside, then rerun setup.');
    const stage=await mkdtemp(path.join(runtime,'dexter-install-'));
    try {
      await run('git',['init',stage],runtime,true);
      await run('git',['remote','add','origin',PINS.dexter.repository+'.git'],stage,true);
      await run('git',['fetch','--depth','1','origin',PINS.dexter.revision],stage,true);
      await run('git',['checkout','--detach','FETCH_HEAD'],stage,true);
      manifest=await dexterManifest(stage);
      await rm(path.join(stage,'.git'),{recursive:true,force:true});
      await rename(stage,source);
    } finally {await rm(stage,{recursive:true,force:true});}
  }
  await run(bun,['install','--frozen-lockfile','--ignore-scripts'],source);
  await writeFile(path.join(runtime,'dexter-source.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o600});
  const manifestBytes=JSON.stringify(PINS.dexter.modelManifest);
  if(sha(manifestBytes)!==PINS.dexter.modelDigest)throw Error('Internal Qwen manifest pin is inconsistent.');
  for(const layer of [PINS.dexter.modelManifest.config,...PINS.dexter.modelManifest.layers]) {
    await download(`https://registry.ollama.ai/v2/library/qwen3/blobs/${layer.digest}`,path.join(runtime,'ollama-models/blobs',layer.digest.replace(':','-')),{bytes:layer.size,sha256:layer.digest.slice(7)});
  }
  const target=path.join(runtime,'ollama-models/manifests/registry.ollama.ai/library/qwen3/1.7b');
  await mkdir(path.dirname(target),{recursive:true});await writeFile(target,manifestBytes,{mode:0o600});
}
await mkdir(runtime,{recursive:true,mode:0o700});
console.log('Installing pinned, free local providers outside the project.');
if(wants('python')||wants('kronos')||wants('laya')||wants('nautilus')) {
  const uv=await binary('uv',process.env.WOLF_UV_PATH,path.join(homedir(),'.local/bin/uv'));
  const venv=path.join(runtime,'python');if(!await exists(venv)) await run(uv,['venv','--python','3.12',venv]);
  await run(uv,['pip','sync','--python',path.join(venv,process.platform==='win32'?'Scripts/python.exe':'bin/python'),'--require-hashes',path.join(ROOT,'workers/requirements.lock')]);
}
if(wants('kronos')) {
  console.log('Verifying Kronos model and tokenizer.');
  await model(PINS.kronos.model.repository,PINS.kronos.model.revision,PINS.kronos.model.files,path.join(runtime,'models/kronos-mini'));
  await model(PINS.kronos.tokenizer.repository,PINS.kronos.tokenizer.revision,PINS.kronos.tokenizer.files,path.join(runtime,'models/kronos-tokenizer'));
}
if(wants('laya')) {
  console.log('Verifying Laya checkpoint.');const folder=path.join(runtime,'models/laya');
  if(layaImport) {
    for(const [file,pin] of Object.entries(PINS.laya.model.files)) {
      if(!await valid(path.join(layaImport,file),pin))throw Error('Laya import does not match the pinned ONNX export: '+file);
      await mkdir(path.dirname(path.join(folder,file)),{recursive:true});
      if(path.join(layaImport,file)!==path.join(folder,file))await copyFile(path.join(layaImport,file),path.join(folder,file));
    }
  } else if(await exists(path.join(folder,'model.onnx'))) {
    for(const [file,pin] of Object.entries(PINS.laya.model.files))if(!await valid(path.join(folder,file),pin))throw Error('Installed ONNX export changed; reimport the verified export or move it aside.');
  } else await model(PINS.laya.model.repository,PINS.laya.model.revision,PINS.laya.model.checkpointFiles,folder);
}
if(wants('dexter')) {console.log('Verifying Dexter, its locked dependencies and local Qwen model.');await setupDexter();}
const registry=createProviderRegistry({config:{runtimeDir:runtime}});
try {
  console.log(JSON.stringify((await registry.status()).map(({id,installed,configured,verified,reason})=>({id,installed,configured,verified,reason})),null,2));
  if(flags.has('--verify')) {
    const response=await fetch('https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=3600',{signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw Error('Public Coinbase observations unavailable for verification.');
    const raw=await response.json();
    const candles=raw.filter(c=>c[0]*1000+3600000<Date.now()).sort((a,b)=>a[0]-b[0]).slice(-64).map(c=>({timestamp:c[0],low:c[1],high:c[2],open:c[3],close:c[4],volume:c[5]}));
    const results={observedAt:new Date().toISOString(),fixtureNotice:'Classification uses a labeled invented diagnostic sentence. Forecast/replay/research use actual public Coinbase observations. These checks prove execution, not predictive skill.'};
    if(wants('kronos'))results.kronos=await registry.forecast({candles,horizon:3,symbol:'BTC-USD',sourceUrl:'https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=3600'});
    if(wants('laya'))results.laya=await registry.classify({text:'Diagnostic fixture: a tariff proposal was announced, but no signed order or implementation date exists.',market:{question:'Has the tariff legally taken effect?',rules:'An actual implemented tariff is required; a proposal does not qualify.'}});
    if(wants('nautilus'))results.nautilus=await registry.replay({candles,orders:[{afterBar:1,side:'BUY',quantity:0.01},{afterBar:60,side:'SELL',quantity:0.01}]});
    if(wants('dexter'))results.dexter=await registry.research({question:'Summarize only these three observed Bitcoin candles. Identify what these data cannot establish about future returns.',sources:[{id:'coinbase-btc-hourly',url:'https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=3600',title:'Coinbase public hourly candles',text:JSON.stringify(candles.slice(-3)),observedAt:results.observedAt}]});
    await writeFile(path.join(runtime,'verification.json'),JSON.stringify(results,null,2)+'\n',{mode:0o600});
    console.log('Actual local inference and replay completed. Evidence is in the provider runtime verification.json. No trading accounts or paid providers were contacted.');
  }
} finally {registry.close();}
