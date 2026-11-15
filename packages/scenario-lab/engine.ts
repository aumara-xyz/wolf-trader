/**
 * Authored, deterministic scenario fixtures for an isolated demonstration.
 * No imports, clock, network, storage, real market IDs or account capabilities.
 * Scores and paths are scripted illustrations, never live forecasts.
 */
export type ScenarioId = 'tariff' | 'rates' | 'rumor'
export type EvidenceState = 'announcement' | 'confirmed' | 'contradicted'
export type ScenarioTone = 'gold' | 'mint' | 'violet'
export type ScenarioInput = {
  scenarioId: ScenarioId
  evidence: EvidenceState
  maxPerOrder: number
  sourceDelayMs: number
  witnessCopies: number
  permissionRevoked: boolean
}
export type ScenarioDefinition = {
  id: ScenarioId
  title: string
  eyebrow: string
  headline: string
  question: string
  primarySource: string
  confirmationSource: string
  announcement: string
  confirmation: string
  contradiction: string
  branches: readonly {id: string; title: string; summary: string; tone: ScenarioTone; series: readonly number[]}[]
}
export type ScenarioBranch = {
  id: string; title: string; summary: string; tone: ScenarioTone; series: number[]
  units: 'Hypothetical signal index · 100 = start'
}
export type AgentView = {
  id: string; role: 'observer' | 'contract-analyst' | 'critic' | 'risk-manager'
  name: string; stance: string; score: number | null; scoreMeaning: string; rationale: string
}
export type GateCheck = {id: string; label: string; passed: boolean; reason: string}
export type ScenarioResult = {
  schema: 'wolf-scenario-lab/v1'
  capitalMode: 'DEMO'
  input: ScenarioInput
  scenario: ScenarioDefinition
  branches: ScenarioBranch[]
  agents: AgentView[]
  evidence: {id: string; title: string; text: string; sourceFamily: string; status: 'fixture' | 'superseded-fixture'}[]
  proposal: {id: string; amount: number; question: string; strategy: 'authored-confirmation/v1'; meaning: string}
  gate: {allowed: boolean; status: 'PAPER_ALLOW' | 'WATCH' | 'REFUSED'; checks: GateCheck[]; reasons: string[]}
  portfolio: {startingCash: number; cash: number; exposure: number; positionCount: number}
  timeline: {id: string; stage: number; label: string; detail: string; status: 'observed' | 'challenged' | 'allowed' | 'refused' | 'recorded'}[]
  independentSourceCount: number
  deliveryCount: number
  maxSourceDelayMs: number
  notice: string
}

export const DEFAULT_SCENARIO_INPUT: ScenarioInput = {
  scenarioId: 'tariff', evidence: 'announcement', maxPerOrder: 25,
  sourceDelayMs: 250, witnessCopies: 6, permissionRevoked: false,
}

export const SCENARIOS: readonly ScenarioDefinition[] = [
  {
    id: 'tariff', title: 'Tariff shock', eyebrow: 'Policy & politics',
    headline: '“A new tariff is coming.” What actually changed?',
    question: 'Will the fictional tariff be formally enacted by the scenario deadline?',
    primarySource: 'fixture:policy-statement', confirmationSource: 'fixture:official-register',
    announcement: 'An invented public statement says a tariff will be introduced. No enacted instrument accompanies it.',
    confirmation: 'A second invented primary document contains a signed instrument and the effective date required by this fictional contract.',
    contradiction: 'An invented official correction says the proposed tariff has been withdrawn; the earlier statement remains in the record.',
    branches: [
      {id: 'enacted', title: 'The policy takes effect', summary: 'A matching primary document arrives. The rule can be checked against the evidence.', tone: 'mint', series: [100,103,101,108,110,114,113,120,124,127]},
      {id: 'delayed', title: 'The announcement stalls', summary: 'Discussion continues, but the evidence never establishes the required legal action.', tone: 'gold', series: [100,105,103,106,102,104,100,101,99,100]},
      {id: 'withdrawn', title: 'The claim reverses', summary: 'A denial or correction changes the thesis. Earlier interpretations stay visible.', tone: 'violet', series: [100,105,104,98,96,91,93,87,85,82]},
    ],
  },
  {
    id: 'rates', title: 'Rate surprise', eyebrow: 'Macro',
    headline: '“A rate cut is on the table.” Signal or speculation?',
    question: 'Will the fictional central bank announce a rate cut at its scheduled meeting?',
    primarySource: 'fixture:meeting-comment', confirmationSource: 'fixture:bank-bulletin',
    announcement: 'An invented official says a cut is being considered. The scheduled decision has not been published.',
    confirmation: 'An invented dated bank bulletin records the cut at the exact meeting named in this fictional contract.',
    contradiction: 'An invented meeting decision holds rates unchanged, contradicting the earlier speculative interpretation.',
    branches: [
      {id: 'cut', title: 'The cut is confirmed', summary: 'The dated decision matches the exact meeting and action in the fictional rules.', tone: 'mint', series: [100,101,104,102,108,111,115,114,119,123]},
      {id: 'wait', title: 'The decision stays open', summary: 'Commentary changes sentiment while the required publication remains absent.', tone: 'gold', series: [100,103,100,102,105,101,103,99,101,100]},
      {id: 'hold', title: 'The bank holds', summary: 'The official outcome contradicts the prediction. A correction is retained.', tone: 'violet', series: [100,102,104,99,96,94,90,93,88,86]},
    ],
  },
  {
    id: 'rumor', title: 'Whale rumor', eyebrow: 'Digital assets',
    headline: '“A major fund is buying.” Six reposts, one source.',
    question: 'Will the fictional fund confirm the specified asset allocation by the scenario deadline?',
    primarySource: 'fixture:allocation-rumor', confirmationSource: 'fixture:fund-disclosure',
    announcement: 'An invented social post claims a fund is buying. Reposts repeat the same original claim without independent evidence.',
    confirmation: 'An invented dated fund disclosure confirms the exact asset allocation specified in this fictional contract.',
    contradiction: 'An invented fund statement denies the allocation; the repeated rumor remains preserved as an earlier claim.',
    branches: [
      {id: 'disclosed', title: 'The disclosure arrives', summary: 'A primary disclosure supports the specific allocation, rather than a vague purchase rumor.', tone: 'mint', series: [100,106,103,109,107,116,119,117,125,130]},
      {id: 'echo', title: 'The rumor echoes', summary: 'More accounts repeat one origin. Delivery count rises; independence does not.', tone: 'gold', series: [100,107,111,105,109,103,106,101,103,100]},
      {id: 'denied', title: 'The fund denies it', summary: 'A primary correction defeats the hypothesis. The crowd cannot vote it into truth.', tone: 'violet', series: [100,108,112,105,98,95,89,92,84,80]},
    ],
  },
]

const MAX_SOURCE_DELAY_MS = 3000
const STARTING_CASH = 1000
const PROPOSED_AMOUNT = 25
const SCORE_MEANING = 'Authored semantic score for this fixture, not calibrated accuracy, event odds or a safety guarantee.'

function normalize(input: Partial<ScenarioInput>): ScenarioInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Provide a demonstration configuration object.')
  const merged = {...DEFAULT_SCENARIO_INPUT, ...input}
  const result: ScenarioInput = {
    scenarioId: merged.scenarioId, evidence: merged.evidence, maxPerOrder: merged.maxPerOrder,
    sourceDelayMs: merged.sourceDelayMs, witnessCopies: merged.witnessCopies, permissionRevoked: merged.permissionRevoked,
  }
  if (!SCENARIOS.some(s => s.id === result.scenarioId)) throw new RangeError('Choose a supported demonstration scenario.')
  if (!['announcement', 'confirmed', 'contradicted'].includes(result.evidence)) throw new RangeError('Choose a supported evidence state.')
  if (!Number.isFinite(result.maxPerOrder) || result.maxPerOrder < 0 || result.maxPerOrder > STARTING_CASH) throw new RangeError('The DEMO order cap must be between 0 and 1,000.')
  if (!Number.isFinite(result.sourceDelayMs) || result.sourceDelayMs < 0 || result.sourceDelayMs > 60_000) throw new RangeError('The simulated source delay must be between 0 and 60,000 ms.')
  if (!Number.isInteger(result.witnessCopies) || result.witnessCopies < 0 || result.witnessCopies > 50) throw new RangeError('Choose 0–50 additional copied deliveries.')
  if (typeof result.permissionRevoked !== 'boolean') throw new TypeError('The demonstration revocation state must be explicit.')
  return result
}

/** Replays an authored fixture. Nothing here enters Wolf's real paper ledger. */
export function runScenario(input: Partial<ScenarioInput> = {}): ScenarioResult {
  const normalized = normalize(input)
  const scenario = SCENARIOS.find(s => s.id === normalized.scenarioId)!
  const confirmed = normalized.evidence === 'confirmed'
  const contradicted = normalized.evidence === 'contradicted'
  const fresh = normalized.sourceDelayMs <= MAX_SOURCE_DELAY_MS
  const sources = confirmed || contradicted ? 2 : 1
  const evidence: ScenarioResult['evidence'] = [
    {id: `fixture:${scenario.id}:statement:v1`, title: 'Original statement', text: scenario.announcement, sourceFamily: scenario.primarySource, status: contradicted ? 'superseded-fixture' : 'fixture'},
  ]
  if (confirmed || contradicted) evidence.push({
    id: `fixture:${scenario.id}:${normalized.evidence}:v2`,
    title: confirmed ? 'Primary confirmation' : 'Primary correction',
    text: confirmed ? scenario.confirmation : scenario.contradiction,
    sourceFamily: scenario.confirmationSource, status: 'fixture',
  })
  const checks: GateCheck[] = [
    {id: 'permission', label: 'Standing permission', passed: !normalized.permissionRevoked, reason: normalized.permissionRevoked ? 'The fictional mandate was revoked. No new effect is permitted.' : 'The authored DEMO mandate is current. This is not an owner signature.'},
    {id: 'evidence', label: 'Exact contract evidence', passed: confirmed, reason: confirmed ? 'The fixture includes a primary confirmation matching the fictional rule.' : contradicted ? 'The primary correction contradicts the hypothesis.' : 'An announcement alone does not establish the required event.'},
    {id: 'freshness', label: 'Source freshness', passed: fresh, reason: fresh ? `Simulated delay ${normalized.sourceDelayMs} ms is within the authored ${MAX_SOURCE_DELAY_MS} ms window.` : `Simulated delay ${normalized.sourceDelayMs} ms exceeds the authored ${MAX_SOURCE_DELAY_MS} ms window.`},
    {id: 'budget', label: 'Per-order limit', passed: PROPOSED_AMOUNT <= normalized.maxPerOrder, reason: PROPOSED_AMOUNT <= normalized.maxPerOrder ? `The $${PROPOSED_AMOUNT} DEMO proposal fits the $${normalized.maxPerOrder} limit.` : `The $${PROPOSED_AMOUNT} DEMO proposal exceeds the $${normalized.maxPerOrder} limit.`},
    {id: 'balance', label: 'Available DEMO capital', passed: PROPOSED_AMOUNT <= STARTING_CASH, reason: 'A separate authored $1,000 balance covers this single demonstration proposal.'},
  ]
  const allowed = checks.every(c => c.passed)
  const status = allowed ? 'PAPER_ALLOW' : normalized.evidence === 'announcement' && checks.filter(c => c.id !== 'evidence').every(c => c.passed) ? 'WATCH' : 'REFUSED'
  const reasons = checks.filter(c => !c.passed).map(c => c.reason)
  const semanticScore = confirmed ? 94 : contradicted ? 12 : 58
  const agents: AgentView[] = [
    {id: 'observer', role: 'observer', name: 'The observer', stance: 'Trace the origin', score: confirmed || contradicted ? 96 : 84, scoreMeaning: SCORE_MEANING, rationale: `${1 + normalized.witnessCopies} deliveries of the original statement still represent one source family.${sources === 2 ? ' A separate authored primary document is present.' : ' More copies cannot establish confirmation.'}`},
    {id: 'analyst', role: 'contract-analyst', name: 'The interpreter', stance: confirmed ? 'Rule match found' : contradicted ? 'Thesis contradicted' : 'Announcement ≠ enactment', score: semanticScore, scoreMeaning: SCORE_MEANING, rationale: confirmed ? 'Within this invented fixture, the confirming document satisfies the exact fictional condition. Financial value has not been forecast.' : contradicted ? 'The new primary statement defeats the earlier interpretation. Keep both revisions in the history.' : 'The statement expresses intent. The fictional contract requires a completed, specifically documented event.'},
    {id: 'critic', role: 'critic', name: 'The challenger', stance: confirmed ? 'Check the countercase' : contradicted ? 'Correction matters' : 'Missing primary proof', score: confirmed ? 76 : contradicted ? 97 : 91, scoreMeaning: SCORE_MEANING, rationale: confirmed ? 'Even a supported semantic conclusion does not prove an advantageous price, real-world truth or a safe investment.' : contradicted ? 'Repeated copies do not outweigh a primary correction. Withdraw the stale thesis without deleting its original record.' : 'Crowd agreement is not independent evidence. Wait for the required source instead of converting enthusiasm into authority.'},
    {id: 'risk', role: 'risk-manager', name: 'The risk steward', stance: allowed ? 'Bounded DEMO effect' : status === 'WATCH' ? 'Watch, do not act' : 'Effect refused', score: null, scoreMeaning: 'Deterministic checks, not a model confidence.', rationale: allowed ? 'Every authored check passes. A $25 simulated effect is calculated inside this isolated fixture only.' : reasons.join(' ')},
  ]
  const timeline: ScenarioResult['timeline'] = [
    {id: 'capture', stage: 1, label: 'Capture the observation', detail: scenario.announcement, status: 'observed'},
    {id: 'cluster', stage: 2, label: 'Separate copies from sources', detail: `${1 + normalized.witnessCopies} statement deliveries · 1 original source family · ${sources} total authored source families.`, status: 'recorded'},
    {id: 'interpret', stage: 3, label: 'Interpret and challenge', detail: agents[1].rationale, status: 'challenged'},
  ]
  if (confirmed || contradicted) timeline.push({id: 'revision', stage: 4, label: confirmed ? 'Retain the confirming document' : 'Append the correction', detail: confirmed ? scenario.confirmation : scenario.contradiction, status: 'recorded'})
  timeline.push({id: 'govern', stage: 5, label: allowed ? 'The checks permit a DEMO effect' : status === 'WATCH' ? 'Wait for evidence' : 'The checks refuse the effect', detail: allowed ? 'The authored $25 proposal is inside the simulated mandate and freshness window.' : reasons.join(' '), status: allowed ? 'allowed' : 'refused'})
  timeline.push({id: 'receipt', stage: 6, label: 'Retain the decision packet', detail: 'This deterministic output can be signed by a separate ephemeral demonstration key. It is not a production research record, owner grant or performance result.', status: 'recorded'})
  return {
    schema: 'wolf-scenario-lab/v1', capitalMode: 'DEMO', input: {...normalized},
    scenario: structuredClone(scenario),
    branches: scenario.branches.map(b => ({...b, series: [...b.series], units: 'Hypothetical signal index · 100 = start'})),
    agents, evidence,
    proposal: {id: `demo:proposal:${scenario.id}`, amount: PROPOSED_AMOUNT, question: scenario.question, strategy: 'authored-confirmation/v1', meaning: 'Scripted DEMO proposal. No event-probability or trading-edge claim; not an executable Wolf market.'},
    gate: {allowed, status, checks, reasons},
    portfolio: {startingCash: STARTING_CASH, cash: allowed ? STARTING_CASH - PROPOSED_AMOUNT : STARTING_CASH, exposure: allowed ? PROPOSED_AMOUNT : 0, positionCount: allowed ? 1 : 0},
    timeline, independentSourceCount: sources, deliveryCount: 1 + normalized.witnessCopies + (sources - 1), maxSourceDelayMs: MAX_SOURCE_DELAY_MS,
    notice: 'Authored scenarios and deterministic agent views. Paths and scores are illustrations, not live feeds, AI inference, market probabilities, actual permission grants or trading results.',
  }
}
