import {useEffect,useId,useMemo,useRef,useState} from 'react'
import {PortalButton,PortalCell,PortalGrid} from '../spatial-ui'
import {DEFAULT_SCENARIO_INPUT,runScenario} from '../scenario-lab/engine'
import type {ScenarioInput} from '../scenario-lab/engine'
import {createDemoReceipt,verifyDemoReceipt} from '../scenario-lab/receipts'
import type {DemoJsonObject,DemoReceipt} from '../scenario-lab/receipts'
import './ScenarioLab.css'

const scenarios=[{id:'tariff',label:'Policy shock',symbol:'◈'},{id:'rates',label:'Rate surprise',symbol:'◇'},{id:'rumor',label:'Market rumor',symbol:'⌁'}] as const
const evidenceOptions=[{id:'announcement',label:'Announcement'},{id:'confirmed',label:'Confirmed'},{id:'contradicted',label:'Contradicted'}] as const

function FutureChart({points,tone}:{points:number[];tone:string}){
 const id=useId().replace(/:/g,'')
 const coordinates=points.map((v,i)=>`${6+i*228/Math.max(1,points.length-1)},${66-(v-70)*.65}`).join(' ')
 return <svg className={`wolf-future-chart is-${tone}`} viewBox="0 0 240 80" role="img" aria-label="Hypothetical signal-index path, not a price prediction">
  <defs><linearGradient id={`future-${id}`} x1="0" y1="0" x2="0" y2="1"><stop stopColor="currentColor" stopOpacity=".22"/><stop offset="1" stopColor="currentColor" stopOpacity="0"/></linearGradient></defs>
  <path d="M6 20h228M6 45h228M6 70h228" className="wolf-future-grid"/>
  <polygon points={`6,78 ${coordinates} 234,78`} fill={`url(#future-${id})`}/>
  <polyline points={coordinates} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" strokeLinecap="round"/>
 </svg>
}

function SmallRing({score}:{score:number}){
 const r=21,c=2*Math.PI*r
 return <div className="wolf-lab-ring" role="img" aria-label={`Authored semantic score ${score} percent; uncalibrated`}><svg viewBox="0 0 54 54" aria-hidden="true"><circle cx="27" cy="27" r={r} className="wolf-lab-ring-track"/><circle cx="27" cy="27" r={r} className="wolf-lab-ring-value" strokeDasharray={`${c*score/100} ${c}`} transform="rotate(-90 27 27)"/></svg><span>{score}<small>%</small></span></div>
}

export function ScenarioLab({active=true}:{active?:boolean}){
 const[open,setOpen]=useState(true),[input,setInput]=useState<ScenarioInput>({...DEFAULT_SCENARIO_INPUT,witnessCopies:0,sourceDelayMs:350})
 const result=useMemo(()=>runScenario(input),[input])
 const[receipt,setReceipt]=useState<DemoReceipt|null>(null),[proof,setProof]=useState(''),[proofError,setProofError]=useState(''),[tampered,setTampered]=useState(false)
 const generation=useRef(0)
 const change=(patch:Partial<ScenarioInput>)=>setInput(previous=>({...previous,...patch}))
 useEffect(()=>{
  const version=++generation.current
  setReceipt(null);setProof('');setProofError('');setTampered(false)
  if(!active)return
  const timer=setTimeout(()=>{
   void(async()=>{
    try{
     const payload=JSON.parse(JSON.stringify(result)) as DemoJsonObject
     const sealed=await createDemoReceipt(payload),verified=await verifyDemoReceipt(sealed)
     if(version===generation.current){setReceipt(sealed);setProof(verified.valid?'Signature verified':'Verification failed');if(!verified.valid)setProofError(verified.reason)}
    }catch(error){if(version===generation.current)setProofError(error instanceof Error?error.message:'Browser signing is unavailable.')}
   })()
  },150)
  return()=>{clearTimeout(timer);generation.current++}
 },[result,active])
 const challenge=async()=>{
  if(!receipt||!active)return
  const version=generation.current
  const altered=structuredClone(receipt)
  altered.payload={...altered.payload,capitalMode:'ALTERED'}
  const verified=await verifyDemoReceipt(altered)
  if(version===generation.current){setTampered(true);setProof(verified.valid?'Unexpected verification result':'Altered record rejected');if(verified.valid)setProofError('The altered payload unexpectedly verified.')}
 }
 const download=()=>{
  if(!receipt)return
  const url=URL.createObjectURL(new Blob([JSON.stringify(receipt,null,2)],{type:'application/json'})),a=document.createElement('a')
  a.href=url;a.download=`wolf-scenario-${input.scenarioId}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
 }
 const discuss=()=>{const node=document.getElementById('wolf-lab-explanation') as HTMLDetailsElement|null;if(node){node.open=true;node.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'nearest'})}}
 return <div className="wolf-foundation wolf-scenario-lab"><PortalGrid open={false}><PortalCell><PortalButton title="Parallel Futures" icon="aura" tone="gold" summary="Explore the event. Challenge the agents. Test the limits." expanded={open} onToggle={()=>setOpen(!open)}>
  <section className="wolf-lab-intro" aria-label="Wolf scenario laboratory">
   <div className="wolf-lab-eyebrow"><span className="wolf-lab-beacon" aria-hidden="true"/>THE SCENARIO LAB<span>01 / EXPLORE</span></div>
   <h3>One event.<br/><span>More than one future.</span></h3>
   <p>Let the researchers disagree. Change the evidence. See what the controls permit.</p>
   <div className="wolf-lab-disclosure">Authored simulation · hypothetical paths · isolated from your account</div>
  </section>
  <div className="wolf-lab-tabs" role="group" aria-label="Choose a scenario">{scenarios.map(s=><button type="button" key={s.id} aria-pressed={input.scenarioId===s.id} onClick={()=>change({scenarioId:s.id})}><span aria-hidden="true">{s.symbol}</span>{s.label}</button>)}</div>
  <div className="wolf-lab-source"><span className="wolf-lab-section-label">THE STARTING SIGNAL</span><h4>{result.scenario.headline}</h4><p>{result.evidence.at(-1)?.text}</p><span className="wolf-lab-source-note">Fictional evidence packet · no live news feed</span></div>
  <div className="wolf-lab-section-heading"><span className="wolf-lab-section-label">THREE POSSIBLE PATHS</span><button type="button" className="wolf-text-action" onClick={discuss}>How this works ↗</button></div>
  <div className="wolf-future-grid-cards">{result.branches.map((branch,i)=><article className={`wolf-future-card is-${branch.tone}${i===(input.evidence==='confirmed'?0:input.evidence==='contradicted'?2:1)?' is-current':''}`} key={branch.id}><div><span>0{i+1}{i===(input.evidence==='confirmed'?0:input.evidence==='contradicted'?2:1)?' · selected premise':''}</span><span className="wolf-future-dot"/></div><h4>{branch.title}</h4><FutureChart points={branch.series} tone={branch.tone}/><p>{branch.summary}</p></article>)}</div>
  <p className="wolf-lab-chart-note">Hypothetical signal index · 100 = scenario start · no market probabilities or price history</p>
  <div className="wolf-lab-section-heading"><span className="wolf-lab-section-label">CHANGE THE WORLD</span><span className="wolf-lab-live-label">Fresh local replay</span></div>
  <fieldset className="wolf-lab-controls"><legend>Simulation controls</legend><div className="wolf-lab-evidence-label">Evidence state<div className="wolf-lab-evidence" role="group" aria-label="Evidence state">{evidenceOptions.map(option=><button type="button" key={option.id} aria-pressed={input.evidence===option.id} onClick={()=>change({evidence:option.id})}>{option.label}</button>)}</div></div>
   <label className="wolf-lab-limit">Demo order limit <strong>${input.maxPerOrder}</strong><input aria-label="Demo order limit" type="range" min="5" max="50" step="5" value={input.maxPerOrder} onChange={e=>change({maxPerOrder:Number(e.target.value)})}/></label>
   <div className="wolf-lab-switches"><label><input type="checkbox" checked={input.sourceDelayMs>3000} onChange={e=>change({sourceDelayMs:e.target.checked?12000:350})}/><span>Delay the source<small>{input.sourceDelayMs>3000?'12 seconds · stale':'350 ms · fresh in this fixture'}</small></span></label><label><input type="checkbox" checked={input.witnessCopies>0} onChange={e=>change({witnessCopies:e.target.checked?10:0})}/><span>Add ten copied witnesses<small>{result.independentSourceCount} independent source {result.independentSourceCount===1?'family':'families'}</small></span></label></div>
   <button type="button" className={`wolf-lab-revoke${input.permissionRevoked?' is-revoked':''}`} aria-pressed={input.permissionRevoked} onClick={()=>change({permissionRevoked:!input.permissionRevoked})}>{input.permissionRevoked?'Restore demo permission':'Revoke demo permission'}<span aria-hidden="true">{input.permissionRevoked?'↻':'⊘'}</span></button>
  </fieldset>
  <div className="wolf-lab-section-heading"><span className="wolf-lab-section-label">INDEPENDENT VIEWS</span><span className="wolf-lab-live-label">Authored agents</span></div>
  <div className="wolf-lab-agents">{result.agents.map((agent,i)=><article key={agent.id} className={`wolf-lab-agent agent-${i}`}><div className="wolf-lab-agent-top"><span className="wolf-lab-agent-glyph" aria-hidden="true">{['◉','◇','⌁','⊞'][i]}</span><div><h4>{agent.name}</h4><span>{agent.role}</span></div>{agent.score!=null?<SmallRing score={agent.score}/>:<span className="wolf-lab-rules-icon" data-passed={result.gate.allowed} aria-label="Deterministic rule checks">{result.gate.allowed?'✓':'⊘'}</span>}</div><strong>{agent.stance}</strong><p>{agent.rationale}</p><small>{agent.scoreMeaning}</small></article>)}</div>
  <div className={`wolf-lab-verdict ${result.gate.allowed?'is-allowed':result.gate.status==='WATCH'?'is-watch':'is-refused'}`} role="status" aria-live="polite"><div className="wolf-lab-verdict-top"><span aria-hidden="true">{result.gate.allowed?'✓':result.gate.status==='WATCH'?'◌':'⊘'}</span><div><span className="wolf-lab-section-label">THE LOCAL DECISION</span><h4>{result.gate.allowed?'Paper proposal admitted':result.gate.status==='WATCH'?'Watch. More evidence needed.':'Paper proposal refused'}</h4></div></div><p>{result.gate.reasons[0]??'The exact controls were checked against this authored scenario.'}</p><div className="wolf-lab-checks">{result.gate.checks.map(check=><div key={check.id} title={check.reason}><span className={check.passed?'is-pass':'is-fail'}>{check.passed?'✓':'−'}</span>{check.label}</div>)}</div><div className="wolf-lab-portfolio"><span>Synthetic starting cash <b>${result.portfolio.startingCash}</b></span><span>Simulated exposure <b>${result.portfolio.exposure}</b></span><span>Counterfactual cash <b>${result.portfolio.cash}</b></span></div><small>Each change starts a fresh $1,000 fixture. Revocation blocks new action; it does not close existing positions. Your actual Wolf account is unchanged.</small></div>
  <details className="wolf-lab-timeline"><summary>Follow the decision trail <span aria-hidden="true">↗</span></summary><ol>{result.timeline.map(event=><li key={event.id} className={`is-${event.status}`}><span className="wolf-lab-timeline-dot"/><div><span>{event.stage}</span><h4>{event.label}</h4><p>{event.detail}</p></div></li>)}</ol></details>
  <div className="wolf-lab-proof"><div><span className="wolf-lab-section-label">A RECORD YOU CAN CHECK</span><h4>{proofError?'Signing unavailable':proof||'Sealing this authored run…'}</h4><p>A real browser signature over this scenario’s exact inputs and results. An ephemeral demo key demonstrates integrity; it grants no owner permission and proves no source truth.</p></div><div className="wolf-action-row"><button type="button" className="wolf-button" disabled={!receipt||Boolean(proofError)} onClick={()=>void challenge()}>{tampered?'Altered bytes failed verification':'Change a recorded fact & verify'}</button><button type="button" className="wolf-text-action" disabled={!receipt} onClick={download}>Export demo receipt ↗</button></div>{receipt&&<details className="wolf-details"><summary>Inspect signature and payload</summary><pre className="wolf-artifact">{JSON.stringify(receipt,null,2)}</pre></details>}{proofError&&<p className="wolf-inline-message is-error" role="alert">{proofError}</p>}</div>
  <details id="wolf-lab-explanation" className="wolf-details wolf-lab-explanation"><summary>Where this goes</summary><p>The next step is to replace authored observations with permitted source snapshots and bounded model assessments, then evaluate the outcomes prospectively. Independent bots could contribute signed research and counterarguments while each owner retains their own account and exact limits.</p><p>This lab borrows the scenario-first idea explored by MiroFish. It runs a deterministic authored engine, not MiroFish or live AI inference. The curves and semantic scores are illustrations. The existing AUKORA research, owner permissions and signed evidence remain separate capabilities below.</p></details>
 </PortalButton></PortalCell></PortalGrid></div>
}
