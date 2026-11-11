import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createProviderRegistry, validateCandles, classificationQuestions, validateTypedAnswers, PINS } from '../packages/providers/index.mjs';

const fixtureCandles = (n=32) => Array.from({length:n},(_,i)=>({timestamp:1700002800+i*3600,open:100,high:102,low:98,close:101,volume:10}));
const fixtureAnswers = () => ({relevance:{noul:0.8},action:{choice:'announced',probabilities:{enacted:0.1,announced:0.7,denied:0.05,unrelated:0.05,unclear:0.1}}});
const evidence = {provider:'jev',text:'Test fixture: a proposed rule was announced.',market:{question:'Has the rule taken effect?',rules:'Must be enacted.'}};
const rejected = code => err => err?.code===code;

test('completed observation boundary rejects future bars, gaps and inconsistent prices',()=>{
  assert.equal(validateCandles({candles:fixtureCandles()}).candles.length,32);
  for(const mutate of [
    c=>{c[31].timestamp=Date.now()/1000;},
    c=>{c[20].timestamp+=3600;},
    c=>{c[2].high=99;},
    c=>{c[1].close=null;},
    c=>{c[1].volume=-1;},
  ]) {const candles=fixtureCandles();mutate(candles);assert.throws(()=>validateCandles({candles}),rejected('PROVIDER_INPUT'));}
});

test('typed semantic output cannot smuggle another choice or unnormalized probability',()=>{
  assert.equal(validateTypedAnswers(fixtureAnswers(),classificationQuestions()).action.choice,'announced');
  const unsupported=fixtureAnswers();unsupported.action.choice='BUY_NOW';
  assert.throws(()=>validateTypedAnswers(unsupported,classificationQuestions()),rejected('PROVIDER_RESPONSE_INVALID'));
  const invalid=fixtureAnswers();invalid.action.probabilities.announced=1;
  assert.throws(()=>validateTypedAnswers(invalid,classificationQuestions()),rejected('PROVIDER_RESPONSE_INVALID'));
});

test('Jev is never called merely because credentials exist',async()=>{
  let calls=0;
  const p=createProviderRegistry({env:{WOLF_JEV_API_KEY:'fixture-credential'},fetchImpl:()=>{calls++;throw Error('Must not call');}});
  try{await assert.rejects(p.classify(evidence),rejected('PROVIDER_PAYMENT_DISABLED'));assert.equal(calls,0);}finally{p.close();}
});

test('paid permission without an explicitly configured key refuses before network',async()=>{
  const p=createProviderRegistry({config:{allowPaidProviders:true},env:{},fetchImpl:()=>{throw Error('Must not call');}});
  try{await assert.rejects(p.classify(evidence),rejected('PROVIDER_NOT_CONFIGURED'));}finally{p.close();}
});

test('Jev uses the official fixed schema and records a semantic judgment, never event odds',async()=>{
  const temp=await mkdtemp(path.join(os.tmpdir(),'wolf-provider-test-'));let calls=0;
  const p=createProviderRegistry({dataDir:temp,config:{allowPaidProviders:true},env:{WOLF_JEV_API_KEY:'fixture-credential'},fetchImpl:async(url,request)=>{
    calls++;assert.equal(url,PINS.jev.endpoint);assert.equal(request.redirect,'error');assert.equal(request.headers.Authorization,'Bearer fixture-credential');
    const body=JSON.parse(request.body);assert.equal(body.model,PINS.jev.model);assert.deepEqual(body.questions,classificationQuestions());assert.equal(body.state.evidence,evidence.text);
    return new Response(JSON.stringify({model:PINS.jev.model,answers:fixtureAnswers(),usage:{total_tokens:100}}),{status:200});
  }});
  try{const result=await p.classify(evidence);assert.equal(calls,1);assert.equal(result.provider,'jev');assert.equal(result.eventProbability,null);assert.equal(result.authorizesOrder,false);assert.match(result.inputHash,/^[a-f0-9]{64}$/);}finally{p.close();await rm(temp,{recursive:true,force:true});}
});

test('provider model drift and upstream HTTP failure are rejected without fallback',async()=>{
  for(const [response,code] of [[new Response(JSON.stringify({model:'jev-99.0.0',answers:fixtureAnswers()})), 'PROVIDER_MODEL_CHANGED'],[new Response('quota',{status:429}),'PROVIDER_UNAVAILABLE']]) {
    let calls=0;const p=createProviderRegistry({config:{allowPaidProviders:true},env:{WOLF_JEV_API_KEY:'fixture-credential'},fetchImpl:async()=>{calls++;return response;}});
    try{await assert.rejects(p.classify(evidence),rejected(code));assert.equal(calls,1);}finally{p.close();}
  }
});

test('oversized contracts and credential-bearing research URLs fail before model invocation',async()=>{
  const p=createProviderRegistry({config:{runtimeDir:'/nonexistent/wolf-test-runtime'},env:{}});
  try {
    await assert.rejects(p.classify({...evidence,market:{...evidence.market,rules:'a'.repeat(3001)}}),rejected('PROVIDER_INPUT'));
    await assert.rejects(p.research({question:'test',sources:[{url:'https://user:password@example.com',text:'fixture'}]}),rejected('PROVIDER_INPUT'));
    await assert.rejects(p.research({question:'test',sources:[{url:'file:///etc/passwd',text:'fixture'}]}),rejected('PROVIDER_INPUT'));
    await assert.rejects(p.forecast({candles:fixtureCandles(),horizon:1.5}),rejected('PROVIDER_INPUT'));
    await assert.rejects(p.replay({candles:fixtureCandles(),orders:[{afterBar:31,side:'BUY',quantity:1}]}),rejected('PROVIDER_INPUT'));
    await assert.rejects(p.replay({candles:fixtureCandles(),orders:[{afterBar:1,side:'BUY',quantity:1},{afterBar:1,side:'SELL',quantity:1}]}),rejected('PROVIDER_INPUT'));
  } finally{p.close();}
});

test('a cancelled local forecast never starts an unavailable worker',async()=>{
  const p=createProviderRegistry({config:{runtimeDir:'/nonexistent/wolf-test-runtime'},env:{}});
  const controller=new AbortController();controller.abort();
  try{await assert.rejects(p.forecast({candles:fixtureCandles(),signal:controller.signal}),rejected('PROVIDER_CANCELLED'));}finally{p.close();}
});

test('missing runtimes stay unavailable and unverified',async()=>{
  const p=createProviderRegistry({config:{runtimeDir:'/nonexistent/wolf-test-runtime'},env:{}});
  try {const status=await p.status();assert.equal(status.length,5);assert.ok(status.every(p=>p.available===false && p.verified===false && p.fundsAccess===false));}finally{p.close();}
});
