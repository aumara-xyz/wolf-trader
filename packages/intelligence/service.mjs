import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { createSources, importedObservation } from './sources.mjs';

const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const idOf = value => typeof value==='string'?value:value?.id??value?.recordId??value?.hash;
const errorView = error => ({code:typeof error.code==='string'?error.code:'STAGE_UNAVAILABLE',message:typeof error.message==='string'?error.message.slice(0,300):'The stage could not finish.'});
const words = text => new Set(String(text).toLowerCase().match(/[a-z]{4,}/g)?.filter(w=>!['will','what','this','that','with','from','before','after','have','does','about','would','could','should','their'].includes(w))??[]);
const fail = (code,message) => { throw Object.assign(new Error(message),{code,status:400}); };
function excerpt(value, maxBytes) {
  let result='',bytes=0;
  for(const char of String(value??'')){const size=Buffer.byteLength(char);if(bytes+size>maxBytes)break;result+=char;bytes+=size;}
  return result;
}
function safePayload(value,depth=0) {
  if(depth>24)fail('EVIDENCE_DEPTH','Evidence is nested too deeply.');
  if(value===null||typeof value!=='object')return;
  for(const [key,item] of Object.entries(value)){
    if(/^(?:authorization|api[_-]?key|secret(?:key)?|private[_-]?key|seed[_-]?phrase|password|mnemonic|access[_-]?token|refresh[_-]?token)$/i.test(key))fail('PRIVATE_FIELD','Credentials do not belong in research evidence.');
    safePayload(item,depth+1);
  }
}
export function relateEvidence(market,observations) {
  const wanted=words(`${market.question} ${market.rules}`), seen=new Set();
  return observations.map(observation=>{
    const overlap=[...words(`${observation.title} ${observation.text}`)].filter(w=>wanted.has(w));
    const action=/\b(sign|signed|enact|enacted|effective|implement|implemented)\b/i.test(market.rules)?'enacted-action':'event-specific';
    const tentative=/\b(plan|propos|intend|consider|could|may|will seek)/i.test(observation.text);
    return {observationId:observation.id,versionId:observation.versionId,evidenceId:observation.evidenceId,sourceUrl:observation.sourceUrl,sourceFamily:observation.sourceFamily,attribution:observation.attribution,overlap:overlap.slice(0,12),relevance:overlap.length,contractRequirement:action,warning:action==='enacted-action'&&tentative?'The statement expresses intent; it does not establish enactment.':'Topic overlap is a lead, not proof of resolution.',establishesOutcome:false};
  }).filter(x=>x.relevance>0).sort((a,b)=>b.relevance-a.relevance).filter(x=>{const identity=x.sourceUrl?.replace('://www.','://');if(seen.has(identity))return false;seen.add(identity);return true;}).slice(0,5);
}
function validateInput(input) {
  if(!input||typeof input!=='object'||Array.isArray(input))fail('SCAN_INPUT','Scan input must be an object.');
  if(input.query!==undefined&&(typeof input.query!=='string'||input.query.length>200))fail('SCAN_INPUT','Use a search topic up to 200 characters.');
  if(input.symbol!==undefined&&!['BTC-USD','ETH-USD'].includes(input.symbol))fail('SCAN_INPUT','Choose BTC-USD or ETH-USD.');
  if(input.marketId!==undefined&&(typeof input.marketId!=='string'||!/^\d{1,100}$/.test(input.marketId)))fail('SCAN_INPUT','Use an exact public market ID.');
  for(const field of ['includeGovernment','useProviders','useJev','useDexter'])if(input[field]!==undefined&&typeof input[field]!=='boolean')fail('SCAN_INPUT',`The ${field} setting must be true or false.`);
  input.signal?.throwIfAborted();
}

/** Owns the observable feed → memory → specialist → evidence loop. Never owns money. */
export function createIntelligenceService({dataDir,markets,ledger,aukora,providers,fetchImpl=fetch,now=Date.now}) {
  mkdirSync(dataDir,{recursive:true});
  const db=new DatabaseSync(join(dataDir,'intelligence.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS observations(id TEXT PRIMARY KEY,source_id TEXT NOT NULL,json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS scans(id TEXT PRIMARY KEY,json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,json TEXT NOT NULL);`);
  const sources=createSources({fetchImpl,now}); let active=null,providerStatus=null,providerStatusAt=0,closed=false;
  for(const row of db.prepare('SELECT id,json FROM jobs').all()) {const job=JSON.parse(row.json);if(['running','cancelling'].includes(job.phase)){job.phase='interrupted';job.stage='Restarted before completion';db.prepare('UPDATE jobs SET json=? WHERE id=?').run(JSON.stringify(job),row.id);}}
  function setJob(job){db.prepare('INSERT OR REPLACE INTO jobs VALUES(?,?)').run(job.id,JSON.stringify(job));}
  function record(kind,payload,parents=[]){
    safePayload(payload);
    let ancestors=[...new Set(parents.filter(Boolean))];
    while(ancestors.length>16){const next=[];for(let i=0;i<ancestors.length;i+=16){const group=ancestors.slice(i,i+16);next.push(idOf(aukora.record('research.parent-group',{ids:group},group)));}ancestors=next;}
    const text=JSON.stringify(payload),bytes=Buffer.from(text??'');
    if(!text||bytes.length>512000)fail('RESEARCH_RECORD_BOUND','A research result exceeded its evidence limit.');
    if(bytes.length<=28000)return aukora.record(kind,payload,ancestors);
    const parts=[],wholeHash=hash(text);
    for(let offset=0;offset<bytes.length;offset+=14000){const part=aukora.record('research.evidence-part',{schema:'wolf-evidence-part/v1',sha256:wholeHash,offset,encoding:'base64',data:bytes.subarray(offset,offset+14000).toString('base64')},parts.length?[parts.at(-1)]:ancestors);parts.push(idOf(part));}
    return aukora.record(kind,{schema:'wolf-evidence-parts/v1',sha256:wholeHash,byteLength:bytes.length,encoding:'utf8-json',parts},[parts.at(-1)]);
  }
  function saveObservation(value){
    const version=`${value.id}:${value.contentHash}`;
    const prior=db.prepare('SELECT json FROM observations WHERE id=?').get(version);
    if(prior)return {...JSON.parse(prior.json),duplicate:true};
    const older=db.prepare('SELECT json FROM observations WHERE source_id=? ORDER BY rowid DESC LIMIT 1').get(value.id);
    const previous=older?JSON.parse(older.json):null;
    const receipt=record('source.observed',{...value,supersedesVersion:previous?.versionId??null},previous?.evidenceId?[previous.evidenceId]:[]);
    const note={text:excerpt(`${value.title}\n${value.text}`,3200)+`\nObserved ${value.receivedAt}; published ${value.publishedAt??'unknown'}. ${value.attribution}`,kind:'finding',capture:'web-derived',sources:[{id:idOf(receipt),url:value.sourceUrl}],parents:[idOf(receipt)]};
    const memory=previous?.memoryId?aukora.correct(previous.memoryId,note):aukora.remember(note);
    const observation={...value,versionId:version,evidenceId:idOf(receipt),memoryId:idOf(memory),supersedesVersion:previous?.versionId??null};
    db.prepare('INSERT INTO observations VALUES(?,?,?)').run(version,value.id,JSON.stringify(observation));
    return observation;
  }
  function observations({limit=30,history=false}={}){
    const count=Math.floor(Math.min(100,Math.max(1,Number(limit)||30)));
    const sql=history?'SELECT json FROM observations ORDER BY rowid DESC LIMIT ?':'SELECT json FROM observations WHERE rowid IN (SELECT MAX(rowid) FROM observations GROUP BY source_id) ORDER BY rowid DESC LIMIT ?';
    return db.prepare(sql).all(count).map(x=>JSON.parse(x.json));
  }
  function latest(){const row=db.prepare('SELECT json FROM scans ORDER BY rowid DESC LIMIT 1').get();return row?JSON.parse(row.json):null;}
  async function status(){
    if(!providerStatus||now()-providerStatusAt>15000){providerStatus=await providers.status();providerStatusAt=now();}
    const job=active?.job??JSON.parse(db.prepare('SELECT json FROM jobs ORDER BY rowid DESC LIMIT 1').get()?.json??'null');
    return {schema:'wolf-intelligence/v1',capitalMode:'DEMO',job,lastScan:latest(),providers:providerStatus,native:aukora.status(),observations:observations({limit:12}),liveOrderSubmission:false};
  }
  async function scan(input={}){
    if(closed)fail('SERVICE_CLOSED','The research service is closed.');
    if(active)throw Object.assign(new Error('A scan is already running.'),{code:'SCAN_BUSY',status:409});
    validateInput(input);
    const query=(input.query??'').trim(),id=randomUUID(),controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),240000);timer.unref();
    const abort=()=>controller.abort();input.signal?.addEventListener('abort',abort,{once:true});
    const job={id,phase:'running',stage:'Reading public markets',startedAt:new Date(now()).toISOString(),stages:[]};
    active={job,controller};setJob(job);
    const step=async(name,work)=>{
      controller.signal.throwIfAborted();job.stage=name;setJob(job);const start=now();
      const opened=record('research.stage-started',{scanId:id,name,startedAt:new Date(start).toISOString(),authority:'research-only'});
      try{
        const value=await work();controller.signal.throwIfAborted();
        const receipt=record('research.stage-completed',{scanId:id,name,durationMs:now()-start,result:value},[idOf(opened)]);
        job.stages.push({name,state:'complete',durationMs:now()-start,evidenceId:idOf(receipt)});setJob(job);return value;
      }catch(error){
        const failure=errorView(error),state=controller.signal.aborted?'cancelled':'unavailable';
        const receipt=record('research.stage-'+state,{scanId:id,name,durationMs:now()-start,...failure},[idOf(opened)]);
        job.stages.push({name,state,durationMs:now()-start,evidenceId:idOf(receipt),...failure});setJob(job);
        if(controller.signal.aborted)throw error;
        return {unavailable:true,...failure};
      }
    };
    try{
      const discovery=await step('Polymarket discovery',()=>input.marketId?markets.market(input.marketId,{fresh:true,signal:controller.signal}).then(m=>({markets:[m]})):markets.searchMarkets({query,limit:6,signal:controller.signal}));
      if(discovery.unavailable)throw Object.assign(new Error(discovery.message),{code:discovery.code});
      if(!Array.isArray(discovery.markets)||discovery.markets.length>6)fail('MARKET_RESPONSE','Market discovery returned an invalid result.');
      const canonical=discovery.markets;
      const parents=canonical.map(m=>idOf(record('market.observed',{query,market:m,observedAt:new Date(now()).toISOString()})));
      const memory=await step('Kira memory recall',()=>Promise.resolve(aukora.recall((query||canonical.map(m=>m.question).join(' ')).slice(0,2000),{limit:6})));
      let documents=[];
      if(input.includeGovernment!==false){const result=await step('Presidential document feed',()=>sources.presidentialDocuments({query:/tariff|trade|sanction|executive|president|trump/i.test(query)?query:'',signal:controller.signal}));if(!result.unavailable)documents=result.map(saveObservation);}
      const availableObservations=observations({limit:50});
      const findings=canonical.map(m=>{const leads=relateEvidence(m,availableObservations);return {marketId:m.id,question:m.question,rulesVersion:m.rulesVersion,leads,sourceFamilies:[...new Set(leads.map(lead=>lead.sourceFamily))],independentProbability:null,forecastStatus:'No calibrated event forecast',authorizesOrder:false};});
      const first=canonical[0],firstLeads=findings[0]?.leads??[];
      const selectedObservations=firstLeads.map(lead=>availableObservations.find(item=>item.versionId===lead.versionId)).filter(Boolean);
      parents.push(...findings.flatMap(f=>f.leads.map(lead=>lead.evidenceId)),...(memory.items??[]).map(note=>note.id));
      const evidenceText=excerpt(selectedObservations.length?selectedObservations.map(item=>`${item.title}\n${item.text}\nSource: ${item.sourceUrl}; ${item.attribution}`).join('\n\n'):'No matching external observation was retrieved. The contract rules alone do not establish that the event occurred.',5800);
      const stages={};let candleRecord=null;
      if(input.useProviders!==false){
        const diagnostic=await step('Specialist availability',()=>providers.status());const rows=Array.isArray(diagnostic)?diagnostic:diagnostic.providers??[];
        const available=id=>rows.find(p=>p.id===id)?.available===true;
        if(available('laya')&&first){
          const excerpts={evidence:excerpt(evidenceText,500),question:excerpt(first.question,160),rules:excerpt(first.rules,250)};
          stages.laya=await step('Laya · local evidence interpretation',async()=>({
            ...await providers.classify({provider:'laya',text:excerpts.evidence,market:{...first,question:excerpts.question,rules:excerpts.rules},signal:controller.signal}),
            scope:{mode:'explicit-excerpts',fullContractReviewed:false,excerpts,sourceEvidenceBytes:Buffer.byteLength(evidenceText),sourceRulesBytes:Buffer.byteLength(first.rules??''),note:'Limited-context semantic check. Complete source rules remain in the market receipt; this result cannot resolve the contract.'},
          }));
        }
        if(available('jev')&&input.useJev===true&&first){stages.jev=await step('Jev · structured semantic judgment',()=>providers.classify({provider:'jev',text:evidenceText,market:first,question:query||'Identify ambiguity in the resolution conditions.',signal:controller.signal}));}
        if(available('dexter')&&input.useDexter===true&&first){
          const researchSources=[{id:`market:${first.id}`,url:first.sourceUrl??first.url,title:first.question,text:excerpt(first.rules||first.question,11000),observedAt:first.receivedAt},...selectedObservations.slice(0,7).map(item=>({id:item.id,url:item.sourceUrl,title:item.title,text:excerpt(item.text||item.title,11000),observedAt:item.receivedAt}))];
          const memoryContext=excerpt((memory.items??[]).map(note=>note.text).join('\n'),1000);
          const question=excerpt((query||'Investigate evidence and uncertainty for the selected prediction market.')+(memoryContext?`\nPrior model memories (untrusted context, not new source evidence):\n${memoryContext}`:''),2900);
          stages.dexter=await step('Dexter · sourced investigation',()=>providers.research({question,market:first,sources:researchSources,signal:controller.signal}));
        }
        if(available('kronos')){candleRecord=await step('Coinbase · complete candle history',()=>sources.candles(input.symbol??'BTC-USD',{signal:controller.signal}));if(!candleRecord.unavailable){const c=record('candles.observed',candleRecord);parents.push(idOf(c));stages.kronos=await step('Kronos · underlying asset forecast',()=>providers.forecast({...candleRecord,horizon:6,signal:controller.signal}));}}
      }
      controller.signal.throwIfAborted();
      parents.push(...job.stages.map(stage=>stage.evidenceId).filter(Boolean));
      const facts=record('research.findings',{findings,specialists:stages,memoryIds:memory?.items?.map(x=>x.id)??[],limitations:['Topic relevance is not outcome probability.','Kronos forecasts an underlying asset; no automatic conversion to Polymarket odds.','Source signatures establish attribution, not factual truth.']},parents);
      for(const item of findings)aukora.remember({kind:'experience',text:excerpt(`${item.question}\n${item.leads.length} source leads. ${item.forecastStatus}. Rules ${item.rulesVersion??'unavailable'}.`,3600),sources:canonical.filter(m=>m.id===item.marketId).map(m=>({id:`market:${m.id}`,url:m.sourceUrl??m.url})),capture:'model-generated',parents:[idOf(facts)]});
      const result={id,observedAt:new Date(now()).toISOString(),query,markets:canonical,findings,specialists:stages,memory,documents:documents.slice(0,6),candles:candleRecord&&!candleRecord.unavailable?{symbol:candleRecord.symbol,sourceUrl:candleRecord.sourceUrl,count:candleRecord.candles.length,observedAt:candleRecord.observedAt,contentHash:candleRecord.contentHash}:null,evidenceId:idOf(facts),signals:[],authorizesOrder:false,stages:job.stages};
      db.prepare('INSERT INTO scans VALUES(?,?)').run(id,JSON.stringify(result));
      job.phase='complete';job.stage='Findings recorded';job.completedAt=result.observedAt;setJob(job);providerStatusAt=0;
      return result;
    }catch(error){job.phase=controller.signal.aborted?'cancelled':'failed';job.stage=controller.signal.aborted?'Scan stopped':errorView(error).message;job.error=errorView(error);setJob(job);throw error;}
    finally{clearTimeout(timer);input.signal?.removeEventListener('abort',abort);active=null;}
  }
  function launch(input={}){validateInput(input);if(active)throw Object.assign(new Error('A scan is already running.'),{code:'SCAN_BUSY',status:409});const promise=scan(input);const job=active?.job;promise.catch(()=>{});return job??{phase:'failed',stage:'Invalid scan input'};}
  function cancel(){if(active){active.job.phase='cancelling';active.job.stage='Stopping research';setJob(active.job);active.controller.abort();}return {cancelled:Boolean(active)};}
  function importObservation(input){return saveObservation(importedObservation(input,now()));}
  function recordConversation(input,result){
    const receipt=record('research.conversation',{input:{message:input.message??input.query},result});
    aukora.remember({text:excerpt(result.answer,3600),sources:(result.sources??[]).slice(0,8),kind:'finding',capture:'model-generated',parents:[idOf(receipt)]});
    return idOf(receipt);
  }

  async function replay(input={}){
    input.signal?.throwIfAborted();
    const history=await sources.candles(input.symbol??'BTC-USD',{signal:input.signal});
    input.signal?.throwIfAborted();
    const quantity=Math.floor(1000/history.candles[0].close*1e6)/1e6;
    if(quantity<=0)fail('REPLAY_SIZE','The fixed baseline cannot be represented at this price.');
    const orders=[{afterBar:0,side:'BUY',quantity},{afterBar:history.candles.length-2,side:'SELL',quantity}];
    const result=await providers.replay({...history,bars:history.candles,orders,startingCash:10000,feeBps:10,signal:input.signal});
    input.signal?.throwIfAborted();
    const receipt=record('experiment.replay',{inputHash:history.contentHash,sourceUrl:history.sourceUrl,baseline:'Fixed $1,000 exposure sized after the first bar; exit after the penultimate bar. Historical underlying-asset replay, not a Polymarket forecast.',orders,result});
    return {...result,evidenceId:idOf(receipt),baseline:'buy-and-hold',orders};
  }
  return {status,scan,launch,cancel,latest,observations,importObservation,recordConversation,replay,readSignals:()=>latest()?.signals??[],close:async()=>{closed=true;cancel();while(active)await new Promise(r=>setTimeout(r,20));db.close();}};
}
