import { describe, expect, it } from 'vitest'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { analyzeReasoningQuality } from '../src/forward-model-analyzer.ts'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

function assistantMessage(seq: number, reasoningText: string): SessionEvent {
  return {
    type: 'assistant/message',
    seq,
    data: {
      turn: 1,
      step: 1,
      message: {
        role: 'assistant',
        content: [{ type: 'reasoning', text: reasoningText }],
      },
    },
  } as unknown as SessionEvent
}

describe('analyzeReasoningQuality', () => {
  it('detects hedging language suggesting unverified assumptions', () => {
    const events: SessionEvent[] = [
      assistantMessage(1, 'This should probably work. I think the types are compatible enough and it should be fine without running tests.'),
    ]
    const signal = analyzeReasoningQuality(events, 0)
    expect(signal).toBeDefined()
    expect(signal?.code).toBe('WEAK_REASONING')
    expect(signal?.description).toContain('hedging')
  })

  it('detects explicit verification avoidance', () => {
    const events: SessionEvent[] = [
      assistantMessage(1, "I don't need to run the tests since the changes are straightforward. Let me just mark this as complete."),
    ]
    const signal = analyzeReasoningQuality(events, 0)
    expect(signal).toBeDefined()
    expect(signal?.code).toBe('WEAK_REASONING')
  })

  it('no signal for confident, verification-oriented reasoning', () => {
    const events: SessionEvent[] = [
      assistantMessage(1, "I need to verify this compiles correctly. Let me run cargo test and check each module's output against the C++ reference binary."),
    ]
    const signal = analyzeReasoningQuality(events, 0)
    expect(signal).toBeUndefined()
  })

  it('does not flag hedging after every verification command succeeds', () => {
    const callId = ToolCallId('verified-call')
    const events: SessionEvent[] = [
      assistantMessage(1, 'This should probably work, but I will verify it with tests.'),
      {
        type: 'tool/call',
        seq: 2,
        time: 2,
        data: { turn: 1, step: 1, callId, name: 'bash', arguments: '{"command":"pnpm run test"}' },
      },
      {
        type: 'tool/result',
        seq: 3,
        data: {
          turn: 1,
          step: 1,
          message: {
            role: 'user',
            content: [{
              type: 'tool-result',
              toolCallId: callId,
              content: [{ type: 'text', text: '24 tests passed' }],
              isError: false,
            }],
          },
        },
      } as unknown as SessionEvent,
    ]
    expect(analyzeReasoningQuality(events, 0)).toBeUndefined()
  })

  it('no signal when no reasoning blocks exist', () => {
    const events: SessionEvent[] = [
      { type: 'tool/call', seq: 1, data: { name: 'read', arguments: '{}' } } as unknown as SessionEvent,
    ]
    const signal = analyzeReasoningQuality(events, 0)
    expect(signal).toBeUndefined()
  })

  it('fires only when multiple hedging indicators co-occur', () => {
    // A single "should" is not enough — needs pattern density
    const events: SessionEvent[] = [
      assistantMessage(1, 'I should start by reading the file to understand the structure.'),
    ]
    const signal = analyzeReasoningQuality(events, 0)
    expect(signal).toBeUndefined()
  })
})
