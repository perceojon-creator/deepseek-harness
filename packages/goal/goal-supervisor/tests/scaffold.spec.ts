import { describe, expect, it } from 'vitest'
import * as goalSupervisor from '../src/index.ts'
import * as goalSupervisorInvariant from '../src/invariant.ts'
import type { SupervisorAction, SupervisorVerdict, EvasionSignal } from '../src/types.ts'

describe('@deepseek-ai/dsh-goal-supervisor scaffolding', () => {
  it('exports plugin name and declared injections', () => {
    expect(goalSupervisor.name).toBe('goal-supervisor')
    expect(goalSupervisor.inject).toEqual(['agents', 'goals', 'llm', 'systemPrompt', 'tools'])
    expect(typeof goalSupervisor.apply).toBe('function')
  })

  it('validates config schema', () => {
    const parsed = goalSupervisor.Config({})
    expect(parsed).toBeDefined()
  })

  it('exports invariant companion with required contract', () => {
    expect(goalSupervisorInvariant.name).toBe('goal-supervisor-invariant')
    expect(goalSupervisorInvariant.inject).toEqual(['invariants'])
    expect(typeof goalSupervisorInvariant.apply).toBe('function')
  })

  it('exports pure types without runtime values', () => {
    const action: SupervisorAction = 'approve'
    const verdict: SupervisorVerdict = {
      action,
      layer: 3,
    }
    const signal: EvasionSignal = {
      code: 'TEST_SIGNAL',
      description: 'test description',
    }
    expect(verdict.action).toBe('approve')
    expect(signal.code).toBe('TEST_SIGNAL')
  })
})
