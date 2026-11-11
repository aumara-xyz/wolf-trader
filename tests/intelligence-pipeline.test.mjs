import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAukoraIntelligence } from '../packages/aukora/index.mjs';
import { createIntelligenceService, relateEvidence } from '../packages/intelligence/service.mjs';
import { composeWolf } from '../packages/runtime/composition.mjs';
const NOW=1794389000000,end=Math.floor(NOW/3600000)*3600;
const market={id:'42',question:'Will the tariff be enacted?',rules:'This market resolves Yes only if the tariff is signed and enacted.',rulesVersion:'rules:1',sourceUrl:'https://gamma-api.polymarket.com/markets/42',url:'https://polymarket.com/event/fixture',receivedAt:new Date(NOW).toISOString()};
const bars=()=>Array.from({length:64},(_,i)=>[end-(64-i)*3600,90,110,100,102,10]);
function setup(t,{providers,fetchImpl,markets}={}){
  const dir=mkdtempSync(join(tmpdir(),'wolf-pipeline-test-'));
  const aukora=createAukoraIntelligence({dataDir:join(dir,'aukora'),now:()=>NOW});
  const service=createIntelligenceService({dataDir:join(dir,'research'),aukora,markets:markets??{searchMarkets:async()=>({markets:[market]}),market:async()=>market},providers:providers??{status:async()=>[]},fetchImpl:fetchImpl??(async()=>new Response(JSON.stringify({results:[]}))),now:()=>NOW});
  t.after(async()=>{await service.close();aukora.close();rmSync(dir,{recursive:true,force:true});});
  return {service,aukora};
}

test('source correction preserves evidence lineage, suppresses old versions, and fits Kira note limits',async t=>{
  const {service,aukora}=setup(t);
  const first=service.importObservation({sourceUrl:'https://truthsocial.com/@official/posts/1',title:'Tariff plan',text:'Tariff proposal. '.repeat(900)});
  const duplicate=service.importObservation({sourceUrl:'https://truthsocial.com/@official/posts/1',title:'Tariff plan',text:'Tariff proposal. '.repeat(900)});
  assert.equal(duplicate.evidenceId,first.evidenceId);assert.equal(duplicate.receivedAt,first.receivedAt);
  const revision=service.importObservation({sourceUrl:'https://truthsocial.com/@official/posts/1',title:'Tariff plan withdrawn',text:'Tariff proposal withdrawn.'});
  assert.equal(service.observations().length,1);assert.equal(service.observations({history:true}).length,2);assert.equal(revision.supersedesVersion,first.versionId);
  const notes=aukora.recall('tariff').items;assert.equal(notes.length,1);assert.match(notes[0].text,/withdrawn/);
  const event=aukora.exportNostrEvent(revision.evidenceId);assert.deepEqual(JSON.parse(event.content).parents,[first.evidenceId]);
  assert.equal(aukora.verifyEvidence(aukora.exportEvidence()).ok,true);
});

test('pipeline feeds relevant bounded source records to actual provider interfaces and retains large results exactly',async t=>{
  const calls={};
  const providers={status:async()=>['laya','kronos','dexter','jev'].map(id=>({id,available:true})),classify:async input=>{calls[input.provider]=input;assert(input.text.length<=6000);assert(!input.text.includes('Unrelated sports'));return {answers:{action:'announced'},eventProbability:null};},research:async input=>{calls.dexter=input;for(const source of input.sources){assert(source.url.startsWith('https://'));assert(source.text.length>0);}return {answer:'A proposal is not enactment. '+ 'detail '.repeat(7000),sourceIds:input.sources.map(s=>s.id),eventProbability:null};},forecast:async input=>{calls.kronos=input;return {symbol:input.symbol,predictions:Array.from({length:6},()=>({close:102})),eventProbability:null};}};
  const {service,aukora}=setup(t,{providers,fetchImpl:async()=>new Response(JSON.stringify(bars()))});
  service.importObservation({sourceUrl:'https://whitehouse.gov/tariffs/1',title:'Tariff proposal',text:'The president intends to propose a tariff; no signed action exists.'});
  service.importObservation({sourceUrl:'https://whitehouse.gov/sports/1',title:'Unrelated sports',text:'A football team won a sporting event.'});
  const result=await service.scan({query:'tariff',includeGovernment:false,useDexter:true,useJev:true});
  assert(calls.laya&&calls.jev&&calls.dexter&&calls.kronos);assert.equal(calls.kronos.candles.length,64);
  assert.equal(result.findings[0].independentProbability,null);assert.equal(result.signals.length,0);assert.equal(result.authorizesOrder,false);
  assert.match(result.findings[0].leads[0].warning,/intent/);assert.equal(calls.dexter.sources.length,2);
  const bundle=aukora.exportEvidence();assert.equal(aukora.verifyEvidence(bundle).ok,true);
  const record=JSON.parse(aukora.exportNostrEvent(result.evidenceId).content).payload;
  assert.equal(record.schema,'wolf-evidence-parts/v1');
  const reconstructed=Buffer.concat(record.parts.map(id=>Buffer.from(JSON.parse(aukora.exportNostrEvent(id).content).payload.data,'base64'))).toString();
  assert.equal(JSON.parse(reconstructed).specialists.dexter.answer,result.specialists.dexter.answer);
});

test('cancelled or pre-aborted scans cannot publish a completed result or invoke later providers',async t=>{
  let release,entered;const started=new Promise(resolve=>{entered=resolve;});
  const providers={status:async()=>[{id:'laya',available:true}],classify:async()=>{entered();return new Promise(resolve=>{release=resolve;});}};
  const {service}=setup(t,{providers});
  const controller=new AbortController();controller.abort();await assert.rejects(service.scan({signal:controller.signal}));
  const promise=service.scan({includeGovernment:false});await started;assert.equal(service.cancel().cancelled,true);release({answer:'late'});await assert.rejects(promise);
  assert.equal(service.latest(),null);assert.equal((await service.status()).job.phase,'cancelled');
  assert.throws(()=>service.launch({query:'x'.repeat(201)}),{code:'SCAN_INPUT'});
});

test('Nautilus receives frozen delayed baseline intents, not an empty replay mislabeled as a strategy',async t=>{
  let input;
  const {service,aukora}=setup(t,{providers:{status:async()=>[],replay:async value=>{input=value;return {fills:2,capitalMode:'PAPER'};}},fetchImpl:async()=>new Response(JSON.stringify(bars()))});
  const result=await service.replay({symbol:'BTC-USD'});
  assert.equal(input.orders.length,2);assert.equal(input.orders[0].afterBar,0);assert.equal(input.orders[1].afterBar,62);assert.equal(input.feeBps,10);assert.equal(result.baseline,'buy-and-hold');
  assert.equal(aukora.verifyEvidence(aukora.exportEvidence()).ok,true);
});

test('same source family and topical matches never become independent outcome confirmations',()=>{
  const observations=[{id:'one',sourceFamily:'whitehouse.gov',sourceUrl:'https://www.whitehouse.gov/action',title:'Tariff',text:'We plan a tariff.'},{id:'two',sourceFamily:'whitehouse.gov',sourceUrl:'https://whitehouse.gov/action',title:'Tariff',text:'We plan a tariff.'}];
  const leads=relateEvidence(market,observations);assert.equal(leads.length,1);assert.equal(leads[0].establishesOutcome,false);
});

test('actual vendored Cordis starts autonomous work and stops it when the lifecycle is disposed',async()=>{
  let starts=0,pauses=0;
  const composition=await composeWolf({markets:{},ledger:{},aukora:{},providers:{},intelligence:{},autonomy:{start(){starts++;},pause(){pauses++;}}});
  assert.equal(starts,1);assert.equal(composition.status().components.length,6);assert(composition.status().components.every(component=>component.available));
  await composition.close();assert.equal(pauses,1);await composition.close();assert.equal(pauses,1);
});
