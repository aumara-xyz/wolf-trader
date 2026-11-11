/** Import the actual pinned Agent without a model call or provider credentials. */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const runtime=path.resolve(process.argv[2]);
const hash=(value: string | Buffer)=>createHash('sha256').update(value).digest('hex');
try {
  const pins=JSON.parse(await readFile(path.join(import.meta.dir,'../packages/providers/pins.json'),'utf8'));
  const manifest=JSON.parse(await readFile(path.join(runtime,'dexter-source.json'),'utf8'));
  if(manifest.revision!==pins.dexter.revision || hash(JSON.stringify(manifest.files))!==pins.dexter.sourceManifestDigest)throw Error('Source manifest is not the pinned Dexter revision.');
  for(const [file,digest] of Object.entries(manifest.files))if(hash(await readFile(path.join(runtime,'dexter',file)))!==digest)throw Error('Pinned Dexter source changed.');
  const {Agent}=await import(pathToFileURL(path.join(runtime,'dexter/src/agent/agent.ts')).href);
  if(typeof Agent.create!=='function')throw Error('Dexter Agent entry point is unavailable.');
  const ollamaVersion=await new Promise<string>((resolve,reject)=>{
    const child=spawn(process.env.WOLF_OLLAMA_PATH||'ollama',['--version'],{env:{PATH:process.env.PATH,OLLAMA_MODELS:path.join(runtime,'ollama-models'),OLLAMA_NO_CLOUD:'1'},stdio:['ignore','pipe','pipe']});let output='';
    child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);child.on('error',reject);child.on('exit',code=>code===0?resolve(output.trim().slice(0,300)):reject(Error('Ollama is unavailable.')));
  });
  let modelReady=false;
  try{modelReady=hash(await readFile(path.join(runtime,'ollama-models/manifests/registry.ollama.ai/library/qwen3/1.7b')))===pins.dexter.modelDigest;}catch{}
  process.stdout.write(JSON.stringify({wolfDiagnostics:true,installed:true,modelReady,bunVersion:Bun.version,ollamaVersion})+'\n');
} catch {
  process.stdout.write(JSON.stringify({wolfDiagnostics:true,installed:false,modelReady:false})+'\n');
  process.exitCode=1;
}
