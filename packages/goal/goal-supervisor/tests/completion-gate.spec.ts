import { describe, expect, it } from 'vitest'
import { CompletionGate } from '../src/completion-gate.ts'

describe('CompletionGate', () => {
  it('blocks completion when no supervisor approval exists', () => {
    const gate = new CompletionGate()
    expect(gate.canComplete('agent-1')).toBe(false)
  })

  it('allows completion after supervisor approval', () => {
    const gate = new CompletionGate()
    gate.approve('agent-1')
    expect(gate.canComplete('agent-1')).toBe(true)
  })

  it('resets approval on new turn', () => {
    const gate = new CompletionGate()
    gate.approve('agent-1')
    gate.resetTurn('agent-1')
    expect(gate.canComplete('agent-1')).toBe(false)
  })

  it('cleans up on dispose', () => {
    const gate = new CompletionGate()
    gate.approve('agent-1')
    gate.dispose('agent-1')
    expect(gate.canComplete('agent-1')).toBe(false)
  })
})
