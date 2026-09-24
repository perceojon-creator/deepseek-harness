import { describe, expect, it } from 'vitest'
import { detectEvasion } from '../src/evasion-detector.ts'
import { GoalId } from '@deepseek-ai/dsh-goal'
import type { GoalView } from '@deepseek-ai/dsh-goal'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

function toolCallEvent(name: string, seq: number, args: Record<string, unknown> = {}): SessionEvent {
  return {
    type: 'tool/call',
    seq,
    data: {
      turn: 1,
      step: 1,
      callId: ToolCallId(`call-${seq}`),
      name,
      arguments: JSON.stringify(args),
    },
  } as unknown as SessionEvent
}

describe('detectEvasion', () => {
  const goal: GoalView = {
    id: GoalId('g1'),
    revision: 1,
    objective: 'Port C++ to Rust',
    phase: 'active',
    maxGoalRounds: 50,
    roundsStarted: 3,
    createdAt: 0,
    updatedAt: 0,
    activation: 'armed',
  }

  it('detects NO_VERIFICATION when >= 3 mutation tools run without verification', () => {
    const events: SessionEvent[] = [
      toolCallEvent('write', 1),
      toolCallEvent('write', 2),
      toolCallEvent('edit', 3),
      toolCallEvent('write', 4),
    ]
    const signals = detectEvasion(events, goal, 0)
    expect(signals.some(s => s.code === 'NO_VERIFICATION')).toBe(true)
  })

  it('no NO_VERIFICATION when verification tool is present', () => {
    const events: SessionEvent[] = [
      toolCallEvent('write', 1),
      toolCallEvent('pwsh', 2),
      toolCallEvent('edit', 3),
    ]
    const signals = detectEvasion(events, goal, 0)
    expect(signals.some(s => s.code === 'NO_VERIFICATION')).toBe(false)
  })

  it('detects PREMATURE_COMPLETE when update_goal complete called without verification', () => {
    const events: SessionEvent[] = [
      toolCallEvent('write', 1),
      toolCallEvent('update_goal', 2, { action: 'complete' }),
    ]
    const signals = detectEvasion(events, goal, 0)
    expect(signals.some(s => s.code === 'PREMATURE_COMPLETE')).toBe(true)
  })

  it('detects INSUFFICIENT_WORK on early round with <= 1 tool call', () => {
    const earlyGoal: GoalView = { ...goal, roundsStarted: 1 }
    const events: SessionEvent[] = [
      toolCallEvent('read', 1),
    ]
    const signals = detectEvasion(events, earlyGoal, 0)
    expect(signals.some(s => s.code === 'INSUFFICIENT_WORK')).toBe(true)
  })
})
