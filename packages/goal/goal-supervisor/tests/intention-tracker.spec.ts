import { describe, expect, it } from 'vitest'
import { extractPlannedTools, IntentionTracker } from '../src/intention-tracker.ts'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
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
        content: [
          { type: 'reasoning', text: reasoningText },
          { type: 'text', text: 'I will do the work now.' },
        ],
      },
    },
  } as unknown as SessionEvent
}

function toolCallEvent(name: string, seq: number, args = '{}'): SessionEvent {
  return {
    type: 'tool/call',
    seq,
    data: { turn: 1, step: 1, callId: ToolCallId(`c${seq}`), name, arguments: args },
  } as unknown as SessionEvent
}

function toolResultEvent(seq: number, callId: string, text: string): SessionEvent {
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
          isError: false,
        }],
      },
    },
  } as unknown as SessionEvent
}

describe('extractPlannedTools', () => {
  it('extracts run commitments that name a verification target', () => {
    expect(extractPlannedTools('I need to run cargo test to verify the changes.')).toEqual(['I need to run cargo test'])
    expect(extractPlannedTools('Let me run the unit tests now.')).toEqual(['Let me run the unit tests'])
    expect(extractPlannedTools('Next, run the build.')).toEqual(['Next, run the build'])
    expect(extractPlannedTools('I’ll execute vitest.')).toEqual(['I’ll execute vitest'])
  })

  it('extracts compile and verify commitments', () => {
    expect(extractPlannedTools('I will compile the crate.')).toEqual(['I will compile'])
    expect(extractPlannedTools('Then I will verify the output.')).toEqual(['Then I will verify the output'])
  })

  it('ignores bare tool and build words without a commitment', () => {
    expect(extractPlannedTools('The bash tool printed the build log; pwsh and run_code are available.')).toEqual([])
    expect(extractPlannedTools('The build directory contains compiled output.')).toEqual([])
  })

  it('ignores negated commitments in the same clause', () => {
    expect(extractPlannedTools("I don't need to run tests.")).toEqual([])
    expect(extractPlannedTools('I will not run the tests.')).toEqual([])
    expect(extractPlannedTools('No need to rebuild, so next run the build is skipped.')).toEqual([])
    expect(extractPlannedTools("I won't compile. Let me run the tests.")).toEqual(['Let me run the tests'])
  })

  it('returns empty for reasoning without verification intent', () => {
    expect(extractPlannedTools('I will read the file and edit line 42.')).toEqual([])
  })
})

describe('IntentionTracker', () => {
  it('detects drift when reasoning promises verification but no verification tool runs', () => {
    const tracker = new IntentionTracker()
    const events: SessionEvent[] = [
      assistantMessage(1, "I'll run cargo test to verify the port is correct, then check the binary output."),
      toolCallEvent('write', 2),
      toolCallEvent('edit', 3),
      toolCallEvent('write', 4),
    ]
    const signal = tracker.detectDrift(events, 0)
    expect(signal).toBeDefined()
    expect(signal?.code).toBe('INTENTION_DRIFT')
    expect(signal?.description).toContain('promised')
  })

  it('no drift when reasoning promises verification and verification tool runs', () => {
    const tracker = new IntentionTracker()
    const events: SessionEvent[] = [
      assistantMessage(1, "I'll run the tests to verify."),
      toolCallEvent('write', 2),
      toolCallEvent('pwsh', 3, '{"command":"pnpm run test"}'),
      toolResultEvent(4, 'c3', '24 tests passed'),
    ]
    const signal = tracker.detectDrift(events, 0)
    expect(signal).toBeUndefined()
  })

  it('does not count an unrelated shell command as fulfilled verification intent', () => {
    const tracker = new IntentionTracker()
    const events: SessionEvent[] = [
      assistantMessage(1, "I'll run the tests to verify."),
      toolCallEvent('bash', 2, '{"command":"ls src"}'),
      toolResultEvent(3, 'c2', 'src'),
    ]
    const signal = tracker.detectDrift(events, 0)
    expect(signal?.code).toBe('INTENTION_DRIFT')
  })

  it('no drift when reasoning has no verification promises', () => {
    const tracker = new IntentionTracker()
    const events: SessionEvent[] = [
      assistantMessage(1, 'I will read the config file and update the settings.'),
      toolCallEvent('read', 2),
      toolCallEvent('edit', 3),
    ]
    const signal = tracker.detectDrift(events, 0)
    expect(signal).toBeUndefined()
  })

  it('no drift when no reasoning blocks exist', () => {
    const tracker = new IntentionTracker()
    const events: SessionEvent[] = [
      toolCallEvent('write', 1),
      toolCallEvent('edit', 2),
    ]
    const signal = tracker.detectDrift(events, 0)
    expect(signal).toBeUndefined()
  })

  it('does not report drift for a negated verification statement', () => {
    const tracker = new IntentionTracker()
    const events: SessionEvent[] = [
      assistantMessage(1, "I don't need to run tests for this documentation edit."),
      toolCallEvent('write', 2),
    ]
    expect(tracker.detectDrift(events, 0)).toBeUndefined()
  })
})
