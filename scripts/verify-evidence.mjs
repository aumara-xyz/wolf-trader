import { readFile } from 'node:fs/promises';
import { verifyEvidence } from '../packages/aukora/index.mjs';
const [file,expectedPubkey,headFile]=process.argv.slice(2);
if(!file){console.error('Usage: npm run wolf:verify -- bundle.json [expected-public-key] [retained-head.json]');process.exit(2);}
try{const bundle=JSON.parse(await readFile(file,'utf8'));const expectedHead=headFile?JSON.parse(await readFile(headFile,'utf8')):undefined;const result=verifyEvidence(bundle,{expectedPubkey,expectedHead});console.log(JSON.stringify(result,null,2));process.exitCode=result.ok?0:1;}catch(error){console.error('Cannot verify bundle:',error.message);process.exitCode=1;}
