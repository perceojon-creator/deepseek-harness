import { describe, expect, it } from 'vitest'
import { parseVerdict } from '../src/supervisor-call.ts'
import { renderSupervisorPrompt } from '../src/supervisor-prompt.ts'
import { renderLedgerInstruction } from '../src/round-prompt-enrichment.ts'

describe('salience map in supervisor output', () => {
  it('parseVerdict extracts salience entries from supervisor JSON', () => {
    const text = '{"action": "redirect", "critique": "Module B untested", "salience": [{"task": "module B pointer arithmetic", "risk": "critical"}, {"task": "module A string handling", "risk": "low"}]}'
    const verdict = parseVerdict(text)
    expect(verdict.action).toBe('redirect')
    expect(verdict.salience).toHaveLength(2)
    expect(verdict.salience?.[0].task).toBe('module B pointer arithmetic')
    expect(verdict.salience?.[0].risk).toBe('critical')
  })

  it('parseVerdict works without salience field (backward compatible)', () => {
    const text = '{"action": "approve"}'
    const verdict = parseVerdict(text)
    expect(verdict.action).toBe('approve')
    expect(verdict.salience).toBeUndefined()
  })

  it('supervisor prompt requests salience output', () => {
    const prompt = renderSupervisorPrompt('Port C++ to Rust', 'summary', [])
    expect(prompt).toContain('salience')
    expect(prompt).toContain('critical')
  })

  it('ledger instruction includes salience map when provided', () => {
    const text = renderLedgerInstruction('any', 3, 50, [
      { task: 'unsafe pointer module', risk: 'critical' },
      { task: 'string utilities', risk: 'low' },
    ])
    expect(text).toContain('unsafe pointer module')
    expect(text).toContain('CRITICAL')
    expect(text).toContain('string utilities')
  })

  it('ledger instruction works without salience (backward compatible)', () => {
    const text = renderLedgerInstruction('any', 3, 50)
    expect(text).toContain('<progress_ledger>')
    expect(text).not.toContain('CRITICAL')
  })
})
