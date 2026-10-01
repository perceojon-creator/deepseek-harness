import { describe, expect, it } from 'vitest'
import { detectEvasion, hasSuccessfulVerification } from '../src/evasion-detector.ts'
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

function toolResultEvent(seq: number, callId: string, text: string, isError = false): SessionEvent {
  return {
    type: 'tool/result',
    seq,
    data: {
      turn: 1,
      step: 1,
      message: {
        role: 'user',
        content: [{
          type: 'tool-result',
          toolCallId: ToolCallId(callId),
          content: [{ type: 'text', text }],
          isError,
        }],
      },
      ...(isError ? { error: { name: 'ProcessError', code: 'EXIT_1' } } : {}),
    },
  } as unknown as SessionEvent
}

function codeDispatchStart(seq: number, name: string, args: Record<string, unknown>): SessionEvent {
  const subCallId = ToolCallId(`run:code:${seq}`)
  return {
    type: 'tool/code-dispatch-start',
    seq,
    data: {
      rootCallId: ToolCallId('run'),
      parentCallId: ToolCallId('run'),
      subCallId,
      name,
      arguments: args,
    },
  } as unknown as SessionEvent
}

function codeDispatchResult(
  seq: number,
  startSeq: number,
  name: string,
  args: Record<string, unknown>,
  text: string,
  isError = false,
): SessionEvent {
  const subCallId = ToolCallId(`run:code:${startSeq}`)
  return {
    type: 'tool/code-dispatch',
    seq,
    data: {
      rootCallId: ToolCallId('run'),
      parentCallId: ToolCallId('run'),
      subCallId,
      name,
      arguments: args,
      isError,
      content: [{ type: 'text', text }],
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

  it('no NO_VERIFICATION when a verification command succeeds', () => {
    const events: SessionEvent[] = [
      toolCallEvent('write', 1),
      toolCallEvent('pwsh', 2, { command: 'pnpm run test' }),
      toolCallEvent('edit', 3),
      toolResultEvent(4, 'call-2', '4 tests passed'),
    ]
    const signals = detectEvasion(events, goal, 0)
    expect(signals.some(s => s.code === 'NO_VERIFICATION')).toBe(false)
  })

  it('does not treat arbitrary output mentioning tests as a verification command', () => {
    const events: SessionEvent[] = [
      toolCallEvent('bash', 1, { command: 'echo test' }),
      toolResultEvent(2, 'call-1', 'test'),
      toolCallEvent('write', 3),
      toolCallEvent('edit', 4),
    ]
    const signals = detectEvasion(events, goal, 0)
    expect(signals.some(s => s.code === 'NO_VERIFICATION')).toBe(true)
  })

  it('detects PREMATURE_COMPLETE when update_goal complete called without verification', () => {
    const events: SessionEvent[] = [
      toolCallEvent('write', 1),
      toolCallEvent('update_goal', 2, { action: 'complete' }),
    ]
    const signals = detectEvasion(events, goal, 0)
    expect(signals.some(s => s.code === 'PREMATURE_COMPLETE')).toBe(true)
  })

  it('does not count a failed test run as completion evidence', () => {
    const events: SessionEvent[] = [
      toolCallEvent('bash', 1, { command: 'pnpm run test' }),
      toolResultEvent(2, 'call-1', '2 tests failed', true),
      toolCallEvent('update_goal', 3, { action: 'complete' }),
    ]
    const signals = detectEvasion(events, goal, 0)
    expect(signals.some(s => s.code === 'PREMATURE_COMPLETE')).toBe(true)
  })

  it('reads nonzero shell exit markers when tool results are not errors', () => {
    const events: SessionEvent[] = [
      toolCallEvent('bash', 1, { command: 'pnpm run test' }),
      toolResultEvent(2, 'call-1', '1 test failed\n[exit code: 1]'),
      toolCallEvent('update_goal', 3, { action: 'complete' }),
    ]
    const signals = detectEvasion(events, goal, 0)
    expect(signals.some(signal => signal.code === 'PREMATURE_COMPLETE')).toBe(true)
  })

  it('recognizes successful PTC sub-dispatches as verification evidence', () => {
    const args = { command: 'pnpm run typecheck' }
    const events = [
      codeDispatchStart(1, 'bash', args),
      codeDispatchResult(2, 1, 'bash', args, 'typecheck passed\n[exit code: 0]'),
    ]

    expect(hasSuccessfulVerification(events)).toBe(true)
  })

  it('rejects PTC verification sub-dispatches with nonzero exit markers', () => {
    const args = { command: 'pnpm run typecheck' }
    const events = [
      codeDispatchStart(1, 'bash', args),
      codeDispatchResult(2, 1, 'bash', args, 'type errors\n[exit code: 1]'),
      toolCallEvent('update_goal', 3, { action: 'complete' }),
    ]

    expect(detectEvasion(events, goal, 0).some(signal => signal.code === 'PREMATURE_COMPLETE')).toBe(true)
  })

  it('requires every verification run to succeed before completion', () => {
    const events: SessionEvent[] = [
      toolCallEvent('bash', 1, { command: 'pnpm run test' }),
      toolResultEvent(2, 'call-1', '24 tests passed'),
      toolCallEvent('pwsh', 3, { command: 'pnpm run typecheck' }),
      toolResultEvent(4, 'call-3', 'type errors found', true),
      toolCallEvent('update_goal', 5, { action: 'complete' }),
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

  it('does not report PREMATURE_COMPLETE when verification succeeded before the completion call', () => {
    const events: SessionEvent[] = [
      toolCallEvent('bash', 1, { command: 'pnpm run test' }),
      toolResultEvent(2, 'call-1', 'ok'),
      toolCallEvent('update_goal', 3, { action: 'complete' }),
    ]
    expect(detectEvasion(events, goal, 0).some(s => s.code === 'PREMATURE_COMPLETE')).toBe(false)
  })

  it('ignores shell calls whose command argument is missing or not a string', () => {
    const events: SessionEvent[] = [
      toolCallEvent('bash', 1, { command: ['pnpm', 'test'] }),
      toolResultEvent(2, 'call-1', 'ok'),
      toolCallEvent('bash', 3, { script: 'pnpm test' }),
      toolResultEvent(4, 'call-3', 'ok'),
      {
        type: 'tool/call',
        seq: 5,
        data: { turn: 1, step: 1, callId: ToolCallId('call-5'), name: 'bash', arguments: '"pnpm test"' },
      } as unknown as SessionEvent,
    ]
    expect(hasSuccessfulVerification(events)).toBe(false)
  })
})
