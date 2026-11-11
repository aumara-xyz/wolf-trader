import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCandles, importedObservation, publicJSON, createSources } from '../packages/intelligence/sources.mjs';
const NOW=1794389000000, HOUR=3600, end=Math.floor(NOW/3600000)*3600;
const candles=()=>Array.from({length:48},(_,i)=>[end-(48-i)*HOUR,90,110,100,102,10]);

test('candle evidence is ordered, complete, contiguous and fresh; missing/duplicate/invalid bars are refused',()=>{
  const input=candles(); input.push([end,90,110,100,102,10]);
  const result=normalizeCandles(input.toReversed(),{now:NOW});
  assert.equal(result.length,48);assert.equal(Date.parse(result.at(-1).timestamp),(end-HOUR)*1000);
  const gap=candles();gap.splice(30,1);assert.throws(()=>normalizeCandles(gap,{now:NOW}),/gap/);
  assert.throws(()=>normalizeCandles([...candles(),candles()[0]],{now:NOW}),/inconsistent/);
  const bad=candles();bad[0][4]=200;assert.throws(()=>normalizeCandles(bad,{now:NOW}),/inconsistent/);
  assert.throws(()=>normalizeCandles(candles(),{now:NOW+4*3600000}),/stale/);
  assert.throws(()=>normalizeCandles(candles(),{now:NOW,intervalSeconds:0}),/window/);
});

test('user-supplied statements remain unverified and corrections keep the same source identity',()=>{
  const first=importedObservation({sourceUrl:'https://www.truthsocial.com/@example/posts/123?utm_campaign=test#reply',text:'Tariff is planned.',publishedAt:'2026-11-10'},NOW);
  const corrected=importedObservation({sourceUrl:'https://truthsocial.com/@example/posts/123',text:'Tariff plan withdrawn.',publishedAt:'2026-11-10'},NOW+1000);
  assert.equal(first.id,corrected.id);assert.notEqual(first.contentHash,corrected.contentHash);
  assert.match(first.attribution,/not independently fetched/);assert.equal(first.resolutionAuthority,false);
  assert.throws(()=>importedObservation({sourceUrl:'https://truthsocial.com:8443/post',text:'claim'},NOW),/original/);
  assert.throws(()=>importedObservation({sourceUrl:'https://truthsocial.com/post',text:'claim',publishedAt:'2026-02-31'},NOW),/invalid/);
  assert.throws(()=>importedObservation({sourceUrl:'https://truthsocial.com.evil.test/post',text:'claim'},NOW),/original/);
});

test('public source reads restrict host, redirect, bytes and cancellation without accepting replaced sources',async()=>{
  let calls=0;
  const fetchImpl=async(url,options)=>{calls++;assert.equal(options.redirect,'error');return new Response(JSON.stringify({ok:true}));};
  assert.deepEqual(await publicJSON('https://www.federalregister.gov/api/v1/documents.json',{fetchImpl}),{ok:true});
  await assert.rejects(publicJSON('https://www.federalregister.gov:8443/data',{fetchImpl}),/not permitted/);
  await assert.rejects(publicJSON('http://www.federalregister.gov/data',{fetchImpl}),/not permitted/);
  const controller=new AbortController();controller.abort();await assert.rejects(publicJSON('https://www.federalregister.gov/data',{fetchImpl,signal:controller.signal}),/aborted/);
  assert.equal(calls,1);
  await assert.rejects(publicJSON('https://www.federalregister.gov/data',{fetchImpl:async()=>new Response('x'.repeat(2000001))}),/size/);
});

test('Federal Register records preserve source time and stable content identity',async()=>{
  let tick=NOW;
  const sources=createSources({now:()=>tick,fetchImpl:async()=>new Response(JSON.stringify({results:[{document_number:'2026-12345',title:'Tariff action',html_url:'https://www.federalregister.gov/documents/2026/11/10/2026-12345/action',abstract:'A proposal for public consideration.',publication_date:'2026-11-10'}]}))});
  const [one]=await sources.presidentialDocuments();tick+=1000;const [two]=await sources.presidentialDocuments();
  assert.equal(one.contentHash,two.contentHash);assert.notEqual(one.receivedAt,two.receivedAt);assert.equal(one.sourceFamily,'federalregister.gov');assert.equal(one.resolutionAuthority,false);
});

test('Federal Register bounds publication by UTC today and skips scheduled records without masking invalid identities',async()=>{
  const now=Date.parse('2026-11-11T00:30:00Z');let requested;
  const document=(number,publication_date)=>({document_number:number,title:'Presidential action',html_url:`https://www.federalregister.gov/documents/${number}/action`,publication_date});
  const past=document('2026-12345','2026-11-10'),today=document('2026-12346','2026-11-11'),scheduled=document('2026-12347','2026-11-12');
  let records=[scheduled,today,past];
  const sources=createSources({now:()=>now,fetchImpl:async url=>{requested=new URL(url);return new Response(JSON.stringify({results:records}));}});
  const observed=await sources.presidentialDocuments({query:'tariff'});
  assert.equal(requested.searchParams.get('conditions[publication_date][lte]'),'2026-11-11');
  assert.equal(requested.searchParams.get('conditions[type][]'),'PRESDOCU');
  assert.equal(requested.searchParams.get('conditions[term]'),'tariff');
  assert.deepEqual(observed.map(row=>row.id),['federal-register:2026-12346','federal-register:2026-12345']);
  assert.ok(observed.every(row=>Date.parse(row.publishedAt)<=now));
  records=[scheduled];assert.deepEqual(await sources.presidentialDocuments(),[]);
  records=[{...scheduled,html_url:'https://untrusted.example/documents/scheduled'}];
  await assert.rejects(sources.presidentialDocuments(),/identity/);
});
