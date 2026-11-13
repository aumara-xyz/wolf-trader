import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generateKeyPairSync,sign} from 'node:crypto';
import {createLedger} from '../../apps/service/ledger.mjs';
import {createAutonomyService} from '../autonomy/index.mjs';
import {createAukoraIntelligence} from '../aukora/index.mjs';
import {createAuthorityService,actionDigest} from '../authority/index.mjs';
import {digest} from '../wolf-core/pricing.mjs';

/** Real controls, synthetic observations and a disposable account; never owner approval. */
export async function runControlChallenges(){
 const results=[];
 for(const scenario of ['positive-control','revoked-permission','changed-source','changed-model','stopped-dependency','broader-mandate']){
  const dir=mkdtempSync(join(tmpdir(),'wolf-control-challenge-'));let runner,ledger,authority,aukora;
  try{
   const clock=Date.now(),now=()=>clock;let waiting,release,changed=false;
   const market={id:'100',question:'Synthetic control event',rules:'Synthetic closed test rules.',rulesVersion:digest('Synthetic closed test rules.'),protocolVersion:'v1',active:true,closed:false,acceptingOrders:true,supported:true,outcomes:[{name:'Yes',assetId:'1001'},{name:'No',assetId:'1002'}],fee:{known:true,model:'none'},quantityStep:'0.01',minOrderNotional:'1'};
   const markets={market:async()=>market,book:async assetId=>({assetId,receivedAt:new Date(clock).toISOString(),bids:[{price:'0.48',size:'10000'}],asks:[{price:'0.50',size:'10000'}],minOrderSize:'1',minOrderSizeUnit:'shares'})};
   ledger=createLedger({dataDir:dir,markets,now});aukora=createAukoraIntelligence({dataDir:join(dir,'evidence'),now});authority=createAuthorityService({dataDir:join(dir,'authority'),aukora,now,audience:'wolf:disposable-control'});
   const{privateKey,publicKey}=generateKeyPairSync('ec',{namedCurve:'P-256'});
   const approve=input=>{const c=authority.challenge(input);return authority.complete({challengeId:c.id,signature:sign('sha256',Buffer.from(c.signingText),{key:privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url')});};
   approve({action:'enroll',publicKeyJwk:publicKey.export({format:'jwk'})});
   const request={capitalMode:'DEMO',strategy:'weekly-hypothesis/v1',weeklyBookId:'synthetic-book',marketIds:['100'],perOrder:'10',maxExposure:'50',maxMarketExposure:'25',maxEventExposure:'50',maxSessionLoss:'10',maxOrders:2,durationMinutes:5};
   const resource=actionDigest(request),g=approve({action:'grant',terms:{scope:'paper',resource,actions:['arm','trade'],expiresAt:new Date(clock+300000).toISOString(),maxUses:3}}).grant;
   authority.authorize({grantId:g.id,scope:'paper',resource,action:'arm',operationId:'arm',payload:request});
   const signal={id:'synthetic-signal',kind:'weekly-event-hypothesis',bookId:'synthetic-book',marketId:'100',assetId:'1001',rulesVersion:market.rulesVersion,probability:'0.8',observedAt:new Date(clock).toISOString(),expiresAt:new Date(clock+200000).toISOString(),evidenceId:'a'.repeat(64),calibrated:false,modelDigest:'synthetic-model'};
   const wrapped={...ledger,commitDemo:async(...args)=>{if(scenario!=='positive-control'){await new Promise(r=>{release=r;waiting=true;});}return ledger.commitDemo(...args);}};
   runner=createAutonomyService({dataDir:join(dir,'autonomy'),ledger:wrapped,markets,intelligence:aukora,now,readSignals:()=>scenario==='changed-source'&&changed?[]:[changed?{...signal,modelDigest:'different-model'}:signal],authorityGate:({config,quote,final,action,operationId})=>{const permission={grantId:config.authority.grantId,scope:'paper',resource:config.authority.resource,action:action==='arm'?'arm':'trade',operationId:operationId??'preflight',payload:JSON.parse(JSON.stringify(quote??null))};return final?authority.authorize(permission):authority.check(permission);}});
   await runner.arm({...request,authority:{grantId:g.id,resource}});
   if(scenario==='broader-mandate'){
    let rejected=false,code;try{authority.check({grantId:g.id,scope:'paper',resource:actionDigest({...request,maxExposure:'500'}),action:'arm',operationId:'broader',payload:request});}catch(e){rejected=true;code=e.code;}
    results.push({scenario,passed:rejected&&ledger.portfolio().account.cash==='1000.000000',refusal:code,orders:0});continue;
   }
   const tick=runner.tick();
   if(scenario!=='positive-control'){
    for(let i=0;i<500&&!waiting;i++)await new Promise(r=>setImmediate(r));
    if(!waiting)throw Error('The control did not reach its pending effect.');
    if(scenario==='revoked-permission')approve({action:'revoke',grantId:g.id});
    if(scenario==='changed-source'||scenario==='changed-model')changed=true;
    if(scenario==='stopped-dependency')runner.pause('Synthetic dependency unloaded.');
    release();
   }
   await tick;const status=runner.status(),expected=scenario==='positive-control'?1:0;
   results.push({scenario,passed:status.totals.orders===expected,orders:status.totals.orders,cash:ledger.portfolio().account.cash,decision:status.lastDecision,mode:'real governor with synthetic market data'});
  }catch(e){results.push({scenario,passed:false,error:e.code??e.message});}
  finally{await runner?.close();authority?.close();aukora?.close();ledger?.close();rmSync(dir,{recursive:true,force:true});}
 }
 return{schema:'wolf-control-challenge/v1',mode:'disposable synthetic observations and signing identities',allPassed:results.every(r=>r.passed),results,ownerPortfolioChanged:false,performanceClaim:false};
}
