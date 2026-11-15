import {describe, expect, it} from 'vitest'
import {DEFAULT_SCENARIO_INPUT, runScenario, SCENARIOS, type EvidenceState} from '../packages/scenario-lab/engine'

describe('isolated authored scenario lab', () => {
  it('starts with an evidence-led pass rather than manufacturing a confident trade', () => {
    const r = runScenario()
    expect(r.gate.status).toBe('WATCH')
    expect(r.gate.allowed).toBe(false)
    expect(r.portfolio).toEqual({startingCash: 1000, cash: 1000, exposure: 0, positionCount: 0})
    expect(r.agents.find(a => a.role === 'risk-manager')?.score).toBeNull()
    expect(r.notice).toContain('not live feeds')
  })

  for (const scenario of SCENARIOS) {
    for (const evidence of ['announcement', 'confirmed', 'contradicted'] as EvidenceState[]) {
      for (const permissionRevoked of [false, true]) {
        it(`${scenario.id}/${evidence}/revoked=${permissionRevoked}: only current confirmed permission can create a DEMO effect`, () => {
          const r = runScenario({scenarioId: scenario.id, evidence, permissionRevoked})
          const shouldAllow = evidence === 'confirmed' && !permissionRevoked
          expect(r.gate.allowed).toBe(shouldAllow)
          expect(r.portfolio.positionCount).toBe(shouldAllow ? 1 : 0)
          expect(r.portfolio.cash + r.portfolio.exposure).toBe(r.portfolio.startingCash)
          expect(r.portfolio.exposure).toBeLessThanOrEqual(r.input.maxPerOrder)
          expect(r.portfolio.cash).toBeGreaterThanOrEqual(0)
          expect(r.evidence.every(e => e.id.startsWith('fixture:'))).toBe(true)
          expect(r.proposal.id.startsWith('demo:')).toBe(true)
        })
      }
    }
  }

  it('rejects an over-limit proposal rather than changing the limit', () => {
    const r = runScenario({evidence: 'confirmed', maxPerOrder: 24.99})
    expect(r.gate.allowed).toBe(false)
    expect(r.input.maxPerOrder).toBe(24.99)
    expect(r.gate.checks.find(c => c.id === 'budget')?.passed).toBe(false)
    expect(r.portfolio.cash).toBe(1000)
  })

  it('allows a proposal at the exact simulated cap and refuses it just above freshness expiry', () => {
    expect(runScenario({evidence: 'confirmed', maxPerOrder: 25, sourceDelayMs: 3000}).gate.allowed).toBe(true)
    const expired = runScenario({evidence: 'confirmed', maxPerOrder: 25, sourceDelayMs: 3001})
    expect(expired.gate.allowed).toBe(false)
    expect(expired.gate.checks.find(c => c.id === 'freshness')?.passed).toBe(false)
    expect(expired.portfolio.exposure).toBe(0)
  })

  it('does not manufacture independence or permission from copied witnesses', () => {
    for (const evidence of ['announcement', 'confirmed', 'contradicted'] as EvidenceState[]) {
      const one = runScenario({evidence, witnessCopies: 0}), many = runScenario({evidence, witnessCopies: 50})
      expect(many.independentSourceCount).toBe(one.independentSourceCount)
      expect(many.gate).toEqual(one.gate)
      expect(many.portfolio).toEqual(one.portfolio)
      expect(many.deliveryCount - one.deliveryCount).toBe(50)
    }
  })

  it('appends a correction while retaining the original fixture', () => {
    const r = runScenario({evidence: 'contradicted'})
    expect(r.evidence).toHaveLength(2)
    expect(r.evidence[0].status).toBe('superseded-fixture')
    expect(r.evidence[1].title).toBe('Primary correction')
    expect(r.gate.allowed).toBe(false)
  })

  it('replays identically and does not mutate shared fixtures', () => {
    const before = JSON.stringify(SCENARIOS), input = {...DEFAULT_SCENARIO_INPUT, evidence: 'confirmed' as const}
    const a = runScenario(input), b = runScenario(input)
    expect(a).toEqual(b)
    a.branches[0].series[0] = -999
    ;(a.scenario.branches[0].series as number[])[0] = -999
    expect(JSON.stringify(SCENARIOS)).toBe(before)
    expect(runScenario(input)).toEqual(b)
    expect(input).toEqual({...DEFAULT_SCENARIO_INPUT, evidence: 'confirmed'})
  })

  it('exposes three hypothetical paths without claiming they are probability distributions', () => {
    for (const s of SCENARIOS) {
      const r = runScenario({scenarioId: s.id})
      expect(r.branches).toHaveLength(3)
      expect(r.agents).toHaveLength(4)
      expect(r.branches.every(b => b.series[0] === 100 && b.series.every(Number.isFinite))).toBe(true)
      expect(r.branches.every(b => b.units.includes('Hypothetical'))).toBe(true)
      expect(r.agents.filter(a => a.score !== null).every(a => a.scoreMeaning.includes('not calibrated'))).toBe(true)
    }
  })

  it('keeps only the declared input fields in exported packets', () => {
    const r = runScenario({...DEFAULT_SCENARIO_INPUT, ownerKey: 'not-a-real-key', extraAuthority: true} as never)
    expect(r.input).toEqual(DEFAULT_SCENARIO_INPUT)
    expect(JSON.stringify(r)).not.toContain('not-a-real-key')
    expect(JSON.stringify(r)).not.toContain('extraAuthority')
  })

  it.each([
    {maxPerOrder: NaN}, {maxPerOrder: Infinity}, {maxPerOrder: -1}, {maxPerOrder: 1001},
    {sourceDelayMs: -1}, {sourceDelayMs: Infinity}, {sourceDelayMs: 60001},
    {witnessCopies: 0.5}, {witnessCopies: -1}, {witnessCopies: 51},
    {scenarioId: 'unknown'}, {evidence: 'certain'}, {permissionRevoked: 'false'},
  ])('refuses malformed configuration %j', invalid => {
    expect(() => runScenario(invalid as never)).toThrow()
  })
})
