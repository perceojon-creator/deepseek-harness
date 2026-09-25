import { describe, expect, it } from 'vitest'
import { PerseverationTracker, computeErrorSignature } from '../src/perseveration-detector.ts'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

function toolCallEvent(name: string, seq: number, callId: string): SessionEvent {
  return {
    type: 'tool/call',
    seq,
    data: { turn: 1, step: 1, callId: ToolCallId(callId), name, arguments: '{}' },
  } as unknown as SessionEvent
}

function toolResultEvent(seq: number, callId: string, errorText: string): SessionEvent {
  return {
    type: 'tool/result',
    seq,
    data: {
      turn: 1,
      step: 1,
      message: {
        role: 'user',
        content: [
          {
            type: 'tool-result',
            toolCallId: ToolCallId(callId),
            content: [{ type: 'text', text: errorText }],
            isError: true,
          },
        ],
      },
      error: { name: 'ToolExecutionError', code: 'EXEC_FAILED' },
    },
  } as unknown as SessionEvent
}

function successResultEvent(seq: number, callId: string): SessionEvent {
  return {
    type: 'tool/result',
    seq,
    data: {
      turn: 1,
      step: 1,
      message: {
        role: 'user',
        content: [
          {
            type: 'tool-result',
            toolCallId: ToolCallId(callId),
            content: [{ type: 'text', text: 'ok' }],
          },
        ],
      },
    },
  } as unknown as SessionEvent
}

describe('computeErrorSignature', () => {
  it('returns undefined when no errors in turn', () => {
    const events: SessionEvent[] = [
      toolCallEvent('pwsh', 1, 'c1'),
      successResultEvent(2, 'c1'),
    ]
    expect(computeErrorSignature(events, 0)).toBeUndefined()
  })

  it('produces identical signatures for identical error patterns', () => {
    const eventsA: SessionEvent[] = [
      toolCallEvent('pwsh', 1, 'c1'),
      toolResultEvent(2, 'c1', 'error: cannot find module X'),
    ]
    const eventsB: SessionEvent[] = [
      toolCallEvent('pwsh', 3, 'c2'),
      toolResultEvent(4, 'c2', 'error: cannot find module X'),
    ]
    const sigA = computeErrorSignature(eventsA, 0)
    const sigB = computeErrorSignature(eventsB, 0)
    expect(sigA).toBeDefined()
    expect(sigA).toBe(sigB)
  })

  it('produces different signatures for different errors', () => {
    const eventsA: SessionEvent[] = [
      toolCallEvent('pwsh', 1, 'c1'),
      toolResultEvent(2, 'c1', 'error: cannot find module X'),
    ]
    const eventsB: SessionEvent[] = [
      toolCallEvent('pwsh', 3, 'c2'),
      toolResultEvent(4, 'c2', 'error: type mismatch in foo.rs'),
    ]
    expect(computeErrorSignature(eventsA, 0)).not.toBe(computeErrorSignature(eventsB, 0))
  })
})

describe('PerseverationTracker', () => {
  it('does not signal before 3 consecutive identical errors', () => {
    const tracker = new PerseverationTracker()
    const events: SessionEvent[] = [
      toolCallEvent('pwsh', 1, 'c1'),
      toolResultEvent(2, 'c1', 'error: cannot find module X'),
    ]
    tracker.recordTurn(events, 0)
    expect(tracker.detect()).toBeUndefined()
    tracker.recordTurn(events, 0)
    expect(tracker.detect()).toBeUndefined()
  })

  it('signals PERSEVERATION after 3 consecutive identical errors', () => {
    const tracker = new PerseverationTracker()
    const events: SessionEvent[] = [
      toolCallEvent('pwsh', 1, 'c1'),
      toolResultEvent(2, 'c1', 'error: cannot find module X'),
    ]
    tracker.recordTurn(events, 0)
    tracker.recordTurn(events, 0)
    tracker.recordTurn(events, 0)
    const signal = tracker.detect()
    expect(signal).toBeDefined()
    expect(signal?.code).toBe('PERSEVERATION')
    expect(signal?.description).toContain('3')
    expect(signal?.description).toContain('same error')
  })

  it('resets streak when a different error occurs', () => {
    const tracker = new PerseverationTracker()
    const eventsA: SessionEvent[] = [
      toolCallEvent('pwsh', 1, 'c1'),
      toolResultEvent(2, 'c1', 'error A'),
    ]
    const eventsB: SessionEvent[] = [
      toolCallEvent('pwsh', 3, 'c2'),
      toolResultEvent(4, 'c2', 'error B'),
    ]
    tracker.recordTurn(eventsA, 0)
    tracker.recordTurn(eventsA, 0)
    tracker.recordTurn(eventsB, 0)
    expect(tracker.detect()).toBeUndefined()
  })

  it('resets streak when a turn has no errors', () => {
    const tracker = new PerseverationTracker()
    const errorEvents: SessionEvent[] = [
      toolCallEvent('pwsh', 1, 'c1'),
      toolResultEvent(2, 'c1', 'error A'),
    ]
    const okEvents: SessionEvent[] = [
      toolCallEvent('pwsh', 3, 'c2'),
      successResultEvent(4, 'c2'),
    ]
    tracker.recordTurn(errorEvents, 0)
    tracker.recordTurn(errorEvents, 0)
    tracker.recordTurn(okEvents, 0)
    expect(tracker.detect()).toBeUndefined()
  })

  it('reset() clears all state', () => {
    const tracker = new PerseverationTracker()
    const events: SessionEvent[] = [
      toolCallEvent('pwsh', 1, 'c1'),
      toolResultEvent(2, 'c1', 'error A'),
    ]
    tracker.recordTurn(events, 0)
    tracker.recordTurn(events, 0)
    tracker.recordTurn(events, 0)
    tracker.reset()
    expect(tracker.detect()).toBeUndefined()
  })
})
