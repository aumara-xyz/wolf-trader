import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {verifyEvidence,verifyArchive} from '../packages/aukora/index.mjs';
const args=process.argv.slice(2),hash=x=>createHash('sha256').update(x).digest('hex');
try{
 if(args[0]==='--manifest'){
  const manifest=JSON.parse(await readFile(args[1],'utf8')),segments=[];
  for(const file of args.slice(2))segments.push(JSON.parse(await readFile(file,'utf8')));
  const result=verifyArchive(manifest,segments);console.log(JSON.stringify(result,null,2));process.exitCode=result.ok?0:1;
 }else{
  const[file,expectedPubkey,headFile]=args;
  if(!file)throw Error('Usage: npm run wolf:verify -- bundle.json [expected-public-key] [retained-head.json], or --manifest manifest.json segment-0.json ...');
  const document=JSON.parse(await readFile(file,'utf8')),bundle=document.schema==='wolf-weekly-export/v1'?document.evidence:document;
  const expectedHead=headFile?JSON.parse(await readFile(headFile,'utf8')):undefined,result=verifyEvidence(bundle,{expectedPubkey,expectedHead});
  if(result.ok&&document.schema==='wolf-weekly-export/v1'){
   const all=new Map(bundle.events.map(e=>[e.id,JSON.parse(e.content)])),record=all.get(document.book?.evidenceId);let body=record?.payload;
   if(record?.kind!=='weekly.book-completed')throw Error('The weekly book has no signed completion record.');
   if(body?.schema==='wolf-weekly-parts/v1'){
    let offset=0;const bytes=Buffer.concat(body.parts.map(id=>{const r=all.get(id);if(r?.kind!=='weekly.payload-part'||r.payload.offset!==offset||r.payload.sha256!==body.sha256)throw Error('A weekly evidence part is missing or changed.');const b=Buffer.from(r.payload.data,'base64');offset+=b.length;return b;}));
    if(offset!==body.byteLength||hash(bytes)!==body.sha256)throw Error('The weekly attachment hash does not match.');body=JSON.parse(bytes.toString());
   }
   const{evidenceId,...book}=document.book;
   if(JSON.stringify(book)!==JSON.stringify(body))throw Error('The exported book differs from the signed weekly evidence.');
   result.weeklyBookBound=true;result.weeklyBookId=book.id;
  }
  console.log(JSON.stringify(result,null,2));process.exitCode=result.ok?0:1;
 }
}catch(error){console.error('Cannot verify artifact:',error.message);process.exitCode=1;}
