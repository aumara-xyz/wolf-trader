import { createHash } from 'node:crypto';

export const SOURCE_DOCS = {
  coinbase: 'https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-product-candles',
  federalRegister: 'https://www.federalregister.gov/developers/documentation/api/v1',
};
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function invalid(message) { throw Object.assign(new Error(message), {code:'SOURCE_INVALID',status:400}); }
function date(value, { optional = false } = {}) {
  if ((value === null || value === undefined || value === '') && optional) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T[^\s]+)?$/.test(value) || !Number.isFinite(Date.parse(value))) invalid('The source publication timestamp is invalid.');
  const result = new Date(value).toISOString();
  if (!value.includes('T') && result.slice(0, 10) !== value) invalid('The source publication date is invalid.');
  return result;
}
export async function publicJSON(url, {fetchImpl=fetch,signal,timeoutMs=15000}={}) {
  const allowed = new Set(['api.exchange.coinbase.com','www.federalregister.gov']);
  const parsed = new URL(url);
  if(parsed.protocol!=='https:'||parsed.port||parsed.username||parsed.password||!allowed.has(parsed.hostname)) invalid('Source host is not permitted.');
  const boundedSignal=AbortSignal.any([signal??new AbortController().signal,AbortSignal.timeout(timeoutMs)]);
  boundedSignal.throwIfAborted();
  const response = await fetchImpl(parsed,{method:'GET',redirect:'error',signal:boundedSignal,headers:{Accept:'application/json','User-Agent':'Wolf-Trader/0.2 public-research'}});
  if(!response.ok) { await response.body?.cancel(); throw Object.assign(new Error(`Public source returned ${response.status}.`),{code:'SOURCE_UNAVAILABLE',status:502}); }
  if(!response.body || Number(response.headers.get('content-length')) > 2_000_000) { await response.body?.cancel(); invalid('Source response exceeds the supported size or has no body.'); }
  let size=0; const chunks=[], reader=response.body.getReader();
  try {
    for (;;) { boundedSignal.throwIfAborted(); const {value,done}=await reader.read(); if(done)break; size+=value.length; if(size>2_000_000){await reader.cancel(); invalid('Source response exceeds the supported size.');} chunks.push(value); }
  } finally { reader.releaseLock(); }
  boundedSignal.throwIfAborted();
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{invalid('Source response is not JSON.');}
}
export function normalizeCandles(raw,{now=Date.now(),intervalSeconds=3600,limit=192}={}) {
  if(!Number.isFinite(now)||![60,300,900,3600,86400].includes(intervalSeconds)||!Number.isInteger(limit)||limit<32||limit>512)invalid('Candle window is invalid.');
  if(!Array.isArray(raw)||raw.length>1000)invalid('Candle response is invalid.');
  const seen=new Set();const rows=[];
  for(const row of raw){
    if(!Array.isArray(row)||row.length!==6||row.some(x=>typeof x!=='number'||!Number.isFinite(x)))invalid('Candle contains non-numeric data.');
    const [t,low,high,open,close,volume]=row;
    if(!Number.isSafeInteger(t)||t<=0||t%intervalSeconds!==0||low<=0||high<low||open<low||open>high||close<low||close>high||volume<0||seen.has(t))invalid('Candle values or timestamps are inconsistent.');
    seen.add(t);
    if((t+intervalSeconds)*1000<=now)rows.push({timestamp:new Date(t*1000).toISOString(),open,high,low,close,volume});
  }
  rows.sort((a,b)=>Date.parse(a.timestamp)-Date.parse(b.timestamp));
  const selected=rows.slice(-limit);
  for(let i=1;i<selected.length;i++)if(Date.parse(selected[i].timestamp)-Date.parse(selected[i-1].timestamp)!==intervalSeconds*1000)invalid('Candle history contains a gap; forecasting paused.');
  if(selected.length<32)invalid('At least 32 complete candles are required.');
  if(now-Date.parse(selected.at(-1).timestamp)>intervalSeconds*2000)invalid('Candle history is stale.');
  return selected;
}
export function createSources({fetchImpl=fetch,now=Date.now}={}) {
  return {
    async candles(symbol='BTC-USD',{signal}={}) {
      if(!['BTC-USD','ETH-USD'].includes(symbol))invalid('Choose BTC-USD or ETH-USD.');
      const sourceUrl=`https://api.exchange.coinbase.com/products/${symbol}/candles?granularity=3600`;
      const raw=await publicJSON(sourceUrl,{fetchImpl,signal});const observedAt=new Date(now()).toISOString();
      const candles=normalizeCandles(raw,{now:now()});
      return {symbol,source:'Coinbase Exchange',sourceUrl,observedAt,intervalSeconds:3600,candles,contentHash:hash(candles),semantics:'Underlying asset candles, not binary event probabilities.'};
    },
    async presidentialDocuments({query='',signal}={}) {
      if(typeof query!=='string'||query.length>200)invalid('The document query is invalid.');
      const url=new URL('https://www.federalregister.gov/api/v1/documents.json');
      url.searchParams.set('per_page','12');url.searchParams.set('order','newest');url.searchParams.set('conditions[type][]','PRESDOCU');
      url.searchParams.set('conditions[publication_date][lte]',new Date(now()).toISOString().slice(0,10));
      if(query.trim())url.searchParams.set('conditions[term]',query.trim().slice(0,150));
      const raw=await publicJSON(url,{fetchImpl,signal});
      if(!Array.isArray(raw.results))invalid('The document catalog is unavailable.');
      const receivedTime=now(),receivedAt=new Date(receivedTime).toISOString();
      return raw.results.slice(0,12).flatMap(item=>{
        let source; try { source=new URL(item.html_url); } catch { invalid('Document identity is missing.'); }
        if(typeof item.document_number!=='string'||!/^[\dA-Z-]{1,40}$/.test(item.document_number)||typeof item.title!=='string'||!item.title.trim()||source.protocol!=='https:'||source.hostname!=='www.federalregister.gov'||source.username||source.password||source.port||!source.pathname.startsWith('/documents/'))invalid('Document identity is missing.');
        const publishedAt=date(item.publication_date);
        // The catalog can expose scheduled documents before publication. Keep
        // those out of observed-publication evidence even if its filter drifts.
        if(Date.parse(publishedAt)>receivedTime)return [];
        const result={id:`federal-register:${item.document_number}`,source:'Federal Register',sourceFamily:'federalregister.gov',sourceUrl:source.href,officialPdf:typeof item.pdf_url==='string'&&item.pdf_url.startsWith('https://www.govinfo.gov/')?item.pdf_url:null,title:item.title.slice(0,1200),text:typeof item.abstract==='string'?item.abstract.slice(0,12000):'',publishedAt,receivedAt,kind:'presidential-document',attribution:'retrieved-public-record',resolutionAuthority:false};
        return [{...result,contentHash:hash({title:result.title,text:result.text,officialPdf:result.officialPdf,publishedAt:result.publishedAt})}];
      });
    },
  };
}
export function importedObservation(input,now=Date.now()) {
  if(!input||typeof input.text!=='string'||!input.text.trim()||input.text.length>16000||!input.text.isWellFormed())invalid('Provide a public statement of at most 16,000 characters.');
  let url;try{url=new URL(input.sourceUrl);}catch{invalid('Provide the original HTTPS source URL.');}
  if(url.protocol!=='https:'||url.port||url.username||url.password||!['truthsocial.com','www.truthsocial.com','whitehouse.gov','www.whitehouse.gov','federalregister.gov','www.federalregister.gov','govinfo.gov','www.govinfo.gov'].includes(url.hostname))invalid('Use an original Truth Social, White House, Federal Register or GovInfo source URL.');
  if(url.href.length>1800)invalid('The original source URL is too long.');
  url.hash='';for(const key of [...url.searchParams.keys()])if(/^utm_|^(?:fbclid|gclid)$/.test(key))url.searchParams.delete(key);
  url.hostname=url.hostname.replace(/^www\./,'');
  const receivedAt=new Date(now).toISOString(), publishedAt=date(input.publishedAt,{optional:true});
  if(publishedAt&&Date.parse(publishedAt)>now)invalid('The statement publication time cannot be in the future.');
  const payload={text:input.text.trim(),sourceUrl:url.href,publishedAt};
  return {id:`import:${hash(url.href)}`,title:typeof input.title==='string'?input.title.trim().slice(0,300):'Imported public statement',...payload,receivedAt,contentHash:hash(payload),kind:'public-statement',source:url.hostname,sourceFamily:url.hostname,attribution:'user-supplied; source text not independently fetched',resolutionAuthority:false};
}
