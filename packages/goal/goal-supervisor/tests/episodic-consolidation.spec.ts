import { describe, expect, it } from 'vitest'
import {
  ConsolidationManager,
  renderConsolidationPrompt,
  parseConsolidation,
} from '../src/episodic-consolidation.ts'

describe('ConsolidationManager.shouldConsolidate', () => {
  it('returns true at the configured interval', () => {
    const mgr = new ConsolidationManager()
    expect(mgr.shouldConsolidate(5, 5)).toBe(true)
    expect(mgr.shouldConsolidate(10, 5)).toBe(true)
  })

  it('returns false between intervals', () => {
    const mgr = new ConsolidationManager()
    expect(mgr.shouldConsolidate(3, 5)).toBe(false)
    expect(mgr.shouldConsolidate(7, 5)).toBe(false)
  })

  it('does not re-trigger at the same round', () => {
    const mgr = new ConsolidationManager()
    expect(mgr.shouldConsolidate(5, 5)).toBe(true)
    expect(mgr.shouldConsolidate(5, 5)).toBe(false)
  })

  it('returns false for round 0', () => {
    const mgr = new ConsolidationManager()
    expect(mgr.shouldConsolidate(0, 5)).toBe(false)
  })
})

describe('renderConsolidationPrompt', () => {
  it('requests structured episodic summary', () => {
    const prompt = renderConsolidationPrompt('Port C++ to Rust', 'summary of 10 turns')
    expect(prompt).toContain('episodic_consolidation')
    expect(prompt).toContain('Verified')
    expect(prompt).toContain('Failed strategies')
    expect(prompt).toContain('Active hypothesis')
  })
})

describe('parseConsolidation', () => {
  it('extracts episodic consolidation block', () => {
    const text = `Here is the consolidation:
<episodic_consolidation>
Verified:
  - parser.cpp -> parser.rs: compiled, tests pass (turn 3)
Failed strategies:
  - Direct template translation (turns 4-6)
Active hypothesis:
  - Trait-based rewrite for templates
</episodic_consolidation>`
    const result = parseConsolidation(text)
    expect(result).toContain('parser.cpp')
    expect(result).toContain('Failed strategies')
  })

  it('returns the full text when no block tags found', () => {
    const text = 'Verified: nothing yet'
    const result = parseConsolidation(text)
    expect(result).toBe(text)
  })
})
