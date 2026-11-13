import { actionDigest, canonicalJson } from './index.mjs';

const BASELINE = Object.freeze({ schema: 'wolf-research-policy/v1', name: 'Initial research filter', minEvidence: 1, minIndependentSources: 1, minRuleClarity: 0.5, maxSourceAgeHours: 72, weights: { confidence: 0.5, independence: 0.25, clarity: 0.25 } });
const copy = value => structuredClone(value);
function fail(code, message) { throw Object.assign(new Error(message), { code, status: 400 }); }
function validate(input) {
  if (!input || Object.keys(input).some(k => !['schema', 'name', 'minEvidence', 'minIndependentSources', 'minRuleClarity', 'maxSourceAgeHours', 'weights'].includes(k))) fail('POLICY_FIELDS', 'Only research filters and ranking weights can change; execution and risk settings are immutable here.');
  if (input.schema !== undefined && input.schema !== BASELINE.schema || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 100) fail('POLICY_SPEC', 'A named declarative research policy is required.');
  for (const key of ['minEvidence', 'minIndependentSources']) if (!Number.isInteger(input[key]) || input[key] < 1 || input[key] > 5) fail('POLICY_SPEC', `${key} must be between 1 and 5.`);
  if (!Number.isFinite(input.minRuleClarity) || input.minRuleClarity < 0 || input.minRuleClarity > 1 || !Number.isFinite(input.maxSourceAgeHours) || input.maxSourceAgeHours < 1 || input.maxSourceAgeHours > 168) fail('POLICY_SPEC', 'Rule clarity or source freshness is out of bounds.');
  if (!input.weights || Object.keys(input.weights).sort().join(',') !== 'clarity,confidence,independence' || Object.values(input.weights).some(n => !Number.isFinite(n) || n < 0 || n > 1) || Math.abs(Object.values(input.weights).reduce((a, b) => a + b, 0) - 1) > 1e-9) fail('POLICY_SPEC', 'Three nonnegative ranking weights must sum to one.');
  return { schema: BASELINE.schema, name: input.name.trim(), minEvidence: input.minEvidence, minIndependentSources: input.minIndependentSources, minRuleClarity: input.minRuleClarity, maxSourceAgeHours: input.maxSourceAgeHours, weights: { confidence: input.weights.confidence, independence: input.weights.independence, clarity: input.weights.clarity } };
}
function assess(spec, item) {
  const ok = Number.isFinite(item.evidenceCount) && Number.isFinite(item.independentSources) && Number.isFinite(item.ruleClarity) && Number.isFinite(item.sourceAgeHours) && Number.isFinite(item.confidence) && item.sourceAgeHours >= 0;
  const eligible = ok && item.evidenceCount >= spec.minEvidence && item.independentSources >= spec.minIndependentSources && item.ruleClarity >= spec.minRuleClarity && item.sourceAgeHours <= spec.maxSourceAgeHours;
  const score = ok ? Math.max(0, Math.min(1, item.confidence)) * spec.weights.confidence + Math.min(1, item.independentSources / 3) * spec.weights.independence + Math.max(0, Math.min(1, item.ruleClarity)) * spec.weights.clarity : 0;
  return { eligible, score, mode: 'SHADOW', authorizesTrade: false };
}
// Fixed grader-owned labels are independent of the proposed policy. These are
// software controls, not historical trading samples or evidence of profitability.
function suite() {
  const good = Array.from({ length: 12 }, (_, i) => ({ id: `clear-independent-${i}`, evidenceCount: 2 + i % 3, independentSources: 2 + i % 2, ruleClarity: 0.9 + i % 2 * 0.05, sourceAgeHours: 2 + i, confidence: 0.55 + i / 100, expected: true, control: false }));
  const bad = Array.from({ length: 12 }, (_, i) => ({ id: `weak-evidence-${i}`, evidenceCount: i % 3 === 0 ? 1 : 3, independentSources: i % 3 === 1 ? 1 : 3, ruleClarity: i % 3 === 2 ? 0.6 : 0.95, sourceAgeHours: 4, confidence: 0.98, expected: false, control: false }));
  return [...good, ...bad, { id: 'control-stale-source', evidenceCount: 3, independentSources: 3, ruleClarity: 1, sourceAgeHours: 100, confidence: 1, expected: false, control: true }, { id: 'control-syndicated-duplicates', evidenceCount: 4, independentSources: 1, ruleClarity: 1, sourceAgeHours: 1, confidence: 1, expected: false, control: true }, { id: 'control-missing-resolution-rule', evidenceCount: 4, independentSources: 3, ruleClarity: 0, sourceAgeHours: 1, confidence: 1, expected: false, control: true }, { id: 'control-empty-evidence', evidenceCount: 0, independentSources: 0, ruleClarity: 1, sourceAgeHours: 1, confidence: 1, expected: false, control: true }];
}

export function createResearchPolicyService({ aukora, authority, now = Date.now } = {}) {
  if (!aukora?.record || !authority?.authorize) throw new TypeError('Research policy needs AUKORA and owner authority.');
  const cases = suite(), suiteHash = actionDigest(cases), candidates = new Map(), reports = new Map();
  let active = null, suiteReceipt = null;
  function fold(row) {
    const p = row.payload;
    if (row.kind === 'research-policy.suite-frozen') { if (p.suiteHash !== suiteHash || canonicalJson(p.cases) !== canonicalJson(cases)) fail('POLICY_SUITE_CHANGED', 'The installed grader differs from the frozen suite; use a new suite version.'); suiteReceipt = row.id; }
    if (row.kind === 'research-policy.proposed') { const spec = validate(p.spec); if (p.id !== actionDigest(spec)) fail('POLICY_INTEGRITY', 'A research policy identity is invalid.'); candidates.set(p.id, { id: p.id, spec, receiptId: row.id }); }
    if (row.kind === 'research-policy.evaluated') reports.set(p.id, { ...p, receiptId: row.id });
    if (row.kind === 'research-policy.shadow-activated') active = { ...p, receiptId: row.id };
  }
  if (aukora.readRecords) { let after = 0, batch; do { batch = aukora.readRecords({ after, limit: 512 }); for (const row of batch) fold(row); after = batch.at(-1)?.sequence ?? after; } while (batch.length); }
  else for (const event of aukora.exportEvidence().events) fold({ id: event.id, ...JSON.parse(event.content) });
  function freezeSuite() {
    if (!suiteReceipt) { const row = aukora.record('research-policy.suite-frozen', { schema: 'wolf-policy-suite/v1', suiteHash, cases, provenance: 'Fixed grader-owned software fixtures; not market outcomes, confidential holdouts, or a claim of trading edge.' }); fold(row); }
  }
  function propose(input) {
    const spec = validate(input), id = actionDigest(spec);
    if (candidates.has(id)) return copy(candidates.get(id));
    freezeSuite(); const row = aukora.record('research-policy.proposed', { id, spec, suiteHash, codeExecution: false }, [suiteReceipt]); fold(row); return copy(candidates.get(id));
  }
  function evaluate(id) {
    const candidate = candidates.get(id); if (!candidate) fail('POLICY_UNKNOWN', 'Propose the exact declarative policy first.');
    const champion = active ? candidates.get(active.candidateId)?.spec : BASELINE;
    if (!champion) fail('POLICY_INTEGRITY', 'The active research policy is missing.');
    const results = cases.map(item => { const challenger = assess(candidate.spec, item), baseline = assess(champion, item); return { id: item.id, control: item.control, expected: item.expected, challenger: challenger.eligible, champion: baseline.eligible, challengerCorrect: challenger.eligible === item.expected, championCorrect: baseline.eligible === item.expected }; });
    const challengerAccuracy = results.filter(r => r.challengerCorrect).length / results.length, championAccuracy = results.filter(r => r.championCorrect).length / results.length;
    const controlsPass = results.filter(r => r.control).every(r => r.challengerCorrect);
    const report = { schema: 'wolf-policy-evaluation/v1', candidateId: id, championId: active?.candidateId ?? null, suiteHash, samples: results.length, challengerAccuracy, championAccuracy, controlsPass, eligible: controlsPass && challengerAccuracy >= 0.85 && challengerAccuracy > championAccuracy, results, evaluatedAt: now(), evidence: 'Frozen grader-owned research-quality fixtures only; no trading performance, hidden holdout, or containment claim.' };
    const reportId = actionDigest(report); const row = aukora.record('research-policy.evaluated', { id: reportId, ...report }, [candidate.receiptId, suiteReceipt]); fold(row); return copy(reports.get(reportId));
  }
  function promotionRequest(id) {
    const report = [...reports.values()].reverse().find(r => r.candidateId === id && r.championId === (active?.candidateId ?? null));
    if (!report?.eligible) fail('POLICY_NOT_ELIGIBLE', 'A challenger must improve on the current champion and pass the frozen controls.');
    const request = { candidateId: id, evaluationId: report.id, expectedActiveId: active?.candidateId ?? null };
    return { request, terms: { scope: 'research-policy', resource: actionDigest(request), actions: ['promote'], expiresAt: new Date(now() + 900000).toISOString(), maxUses: 1 } };
  }
  function promote(request, { grantId } = {}) {
    if (!request || Object.keys(request).sort().join(',') !== 'candidateId,evaluationId,expectedActiveId') fail('POLICY_PROMOTION', 'Promotion must name exact candidate, evaluation, and champion identities.');
    const report = reports.get(request.evaluationId), candidate = candidates.get(request.candidateId);
    if (!candidate || !report?.eligible || report.candidateId !== candidate.id || report.suiteHash !== suiteHash) fail('POLICY_NOT_ELIGIBLE', 'This exact research policy has not passed its evaluation.');
    if (request.expectedActiveId !== (active?.candidateId ?? null) || report.championId !== request.expectedActiveId) fail('POLICY_HEAD_MOVED', 'The research champion changed; evaluate against the current version.');
    const permission = { grantId, scope: 'research-policy', resource: actionDigest(request), action: 'promote', operationId: 'policy-promote:' + grantId, payload: request };
    const approved = authority.authorize(permission); authority.check(permission);
    const row = aukora.record('research-policy.shadow-activated', { ...request, previous: active?.candidateId ?? null, mode: 'SHADOW', riskControlsChanged: false, authorizedBy: approved.receiptId, activatedAt: now() }, [candidate.receiptId, report.receiptId, approved.receiptId]); fold(row); return copy(active);
  }
  return { status: () => ({ schema: 'wolf-research-policy-lab/v1', active: copy(active), champion: active ? copy(candidates.get(active.candidateId)?.spec) : copy(BASELINE), candidates: [...candidates.values()].map(copy), evaluations: [...reports.values()].map(copy), suite: { hash: suiteHash, samples: cases.length, frozen: Boolean(suiteReceipt), evidence: 'Software-quality fixtures; no demonstrated market edge.' }, scope: 'Research ranking in shadow only; cannot modify risk limits, authority, tools, or code.' }), propose, evaluate, promotionRequest, promote, shadowEvaluate: input => assess(active ? candidates.get(active.candidateId).spec : BASELINE, input) };
}
