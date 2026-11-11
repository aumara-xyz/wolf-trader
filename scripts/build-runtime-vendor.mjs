import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const root=fileURLToPath(new URL('../',import.meta.url));
const manifest=JSON.parse(await readFile(resolve(root,'packages/runtime-vendor/SOURCE.json'),'utf8'));
for(const entry of manifest.files){const bytes=await readFile(resolve(root,'packages/runtime-vendor',entry.file));if(createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw new Error('Runtime donor bytes changed: '+entry.file);}
await build({entryPoints:[resolve(root,'packages/runtime-vendor/cordis/src/index.ts')],outfile:resolve(root,'packages/runtime-vendor/cordis.mjs'),bundle:true,format:'esm',platform:'node',target:'node24',absWorkingDir:root,alias:{'@deepseek-ai/cosmokit':resolve(root,'packages/runtime-vendor/cosmokit/src/index.ts')}});
console.log('Verified and built pinned X6.1 Cordis runtime.');
