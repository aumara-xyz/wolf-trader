import {useId} from 'react'
import type {CSSProperties} from 'react'
import './WeeklyVisuals.css'

// Presentation-only scenarios. They deliberately have no market IDs, assets or
// execution fields and never enter a research book, grant or performance record.
const examples = [
  {theme:'gold',kind:'bitcoin',category:'Digital assets',title:'Bitcoin holds above $70,000 at Sunday’s close',confidence:72,series:[42,47,45,52,49,58,56,63,61,67,65,72],thesis:'Example thesis: sustained spot demand and a successful retest would support a hold above the threshold.',countercase:'A fast reversal in liquidity could overwhelm the technical setup.',invalidation:'A break below the threshold, or unclear settlement rules, would force a fresh investigation.'},
  {theme:'violet',kind:'policy',category:'Policy & politics',title:'A new US tariff measure is formally enacted this week',confidence:61,series:[40,43,39,47,51,46,54,52,59,56,63,61],thesis:'Example thesis: official notices, rather than political headlines alone, would establish a near-term path to enactment.',countercase:'Announcements may be delayed, narrowed or challenged before they take legal effect.',invalidation:'No dated primary notice, or a mismatch with the market’s resolution rule, means pass.'},
  {theme:'mint',kind:'gold',category:'Macro',title:'Gold closes the week above its opening price',confidence:68,series:[46,49,48,54,51,55,60,57,64,62,66,68],thesis:'Example thesis: softer yields and defensive demand could support the weekly direction.',countercase:'A stronger dollar or rising real yields could reverse that move.',invalidation:'Conflicting price sources or a changed closing benchmark would invalidate the comparison.'},
] as const

function ConfidenceRing({value,label,muted=false}:{value?:number;label:string;muted?:boolean}){
 const safe=value!=null&&Number.isFinite(value)&&value>=0&&value<=100?value:undefined
 const radius=30,circumference=2*Math.PI*radius
 return <div className={`wolf-confidence${muted?' is-muted':''}`} role="img" aria-label={`${label}: ${safe==null?'no estimate':`${Math.round(safe)} percent`}`}>
  <svg viewBox="0 0 76 76" aria-hidden="true"><circle className="wolf-confidence__track" cx="38" cy="38" r={radius}/>{safe!=null&&!muted&&<circle className="wolf-confidence__value" cx="38" cy="38" r={radius} strokeDasharray={`${circumference*safe/100} ${circumference}`} transform="rotate(-90 38 38)"/>}</svg>
  <span>{safe==null||muted?'—':Math.round(safe)}{safe!=null&&!muted&&<small>%</small>}</span>
 </div>
}

function ScenarioGlyph({kind}:{kind:string}){
 return <svg className="wolf-scenario-glyph" viewBox="0 0 48 48" fill="none" aria-hidden="true">
  {kind==='bitcoin'?<><path d="m24 3 18 10v22L24 45 6 35V13Z"/><path d="M19 15h9a5 5 0 0 1 0 10H19m0 0h10a5 5 0 0 1 0 10H19V15m4-5v5m5-5v5m-5 20v4m5-4v4M15 15h4m-4 20h4"/></>:kind==='policy'?<><path d="m5 18 19-11 19 11H5Zm4 22h30M7 35h34M13 22v10m11-10v10m11-10v10"/><circle cx="24" cy="14" r="1"/></>:<><path d="m8 30 6-14h20l6 14v8H8v-8Zm0 0h32M14 16l5 14m15-14-5 14"/><path d="m18 10 6-5 6 5M24 5v8"/></>}
 </svg>
}

function SampleSparkline({values}:{values:readonly number[]}){
 const id=useId().replace(/:/g,'')
 const points=values.map((v,i)=>`${4+i*212/(values.length-1)},${64-(v-30)*1.05}`).join(' ')
 const last=64-(values[values.length-1]-30)*1.05
 return <svg className="wolf-sample-chart" viewBox="0 0 220 76" role="img" aria-label="Scripted probability path, illustrative only; not price history">
  <defs><linearGradient id={`sample-${id}`} x1="0" y1="0" x2="0" y2="1"><stop stopColor="currentColor" stopOpacity=".19"/><stop offset="1" stopColor="currentColor" stopOpacity="0"/></linearGradient></defs>
  <path className="wolf-sample-chart__grid" d="M4 18h212M4 41h212M4 64h212"/>
  <polygon points={`4,72 ${points} 216,72`} fill={`url(#sample-${id})`}/>
  <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
  <circle cx="216" cy={last} r="3" fill="currentColor"/>
 </svg>
}

export function SampleWeeklyOutlook(){
 return <section className="wolf-weekly-showcase" aria-label="Illustrative weekly outlook">
  <div className="wolf-showcase-heading"><div><span className="wolf-visual-eyebrow">The weekly outlook</span><h3>Three ideas. Every angle.</h3></div><span className="wolf-sample-badge">Sample content</span></div>
  <p className="wolf-showcase-caption">9–15 November 2026 · Three scripted scenarios. Confidence scores and charts are illustrations, not live forecasts or trade signals.</p>
  <div className="wolf-scenario-grid">{examples.map((example,i)=><article key={example.kind} className={`wolf-scenario wolf-scenario--${example.theme}`}>
   <div className="wolf-scenario-top"><ScenarioGlyph kind={example.kind}/><span className="wolf-scenario-number">0{i+1}</span></div>
   <span className="wolf-visual-eyebrow">{example.category}</span><h4>{example.title}</h4>
   <div className="wolf-scenario-score"><ConfidenceRing value={example.confidence} label="Illustrative confidence"/><div className="wolf-scenario-score__caption"><strong>Sample confidence</strong><span>Scripted · uncalibrated</span></div></div>
   <SampleSparkline values={example.series}/><div className="wolf-chart-caption"><span>Illustrative outlook</span><span>Not market history</span></div>
   <details className="wolf-scenario-reason"><summary>Thesis & countercase <span aria-hidden="true">↗</span></summary><p>{example.thesis}</p><p><strong>Countercase</strong> {example.countercase}</p><p><strong>What changes the view</strong> {example.invalidation}</p></details>
  </article>)}</div>
 </section>
}

const probability=(v:unknown)=>{if(typeof v!=='number'&&typeof v!=='string')return undefined;if(typeof v==='string'&&!v.trim())return undefined;const n=Number(v);return Number.isFinite(n)&&n>=0&&n<=1?n:undefined}

/** Only renders retained snapshot values. An abstention is never a 50% signal. */
export function ResearchSignalVisual({forecast,marketProbability}:{forecast?:{probability?:unknown;abstain?:unknown};marketProbability?:unknown}){
 const model=probability(forecast?.probability),market=probability(marketProbability),abstained=Boolean(forecast?.abstain)
 if(abstained||model==null)return <div className="wolf-research-signal is-abstained"><ConfidenceRing label="Research status" muted/><div><strong>{abstained?'Research abstained':'No estimate recorded'}</strong><p>{abstained?'The evidence did not support a forecast. No confidence score is shown.':'This record has no supported probability to display.'}</p></div></div>
 const values=[{label:'Model estimate',value:model},{label:'Market at research',value:market}]
 return <div className="wolf-research-signal"><ConfidenceRing value={model*100} label="Uncalibrated model probability"/><div className="wolf-research-comparison"><strong>Forecast probability · uncalibrated</strong>{values.map(({label,value})=><div className="wolf-probability-row" key={label}><div><span>{label}</span><b>{value==null?'Unavailable':`${(value*100).toFixed(1)}%`}</b></div><span className="wolf-probability-track" aria-hidden="true"><i style={{'--wolf-probability':`${(value??0)*100}%`} as CSSProperties}/></span></div>)}</div></div>
}
