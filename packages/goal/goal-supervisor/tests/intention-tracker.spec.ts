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

function toolCallEvent(name: string, seq: number): SessionEvent {
  return {
    type: 'tool/call',
    seq,
    data: { turn: 1, step: 1, callId: ToolCallId(`c${seq}`), name, arguments: '{}' },
  } as unknown as SessionEvent
}

describe('extractPlannedTools', () => {
  it('extracts verification tool mentions from reasoning', () => {
    const tools = extractPlannedTools(
      'I need to run cargo test to verify the changes, then check with pwsh if the build succeeds.',
    )
    expect(tools).toContain('pwsh')
  })

  it('extracts run_code mentions', () => {
    const tools = extractPlannedTools('Let me use run_code to execute the tests.')
    expect(tools).toContain('run_code')
  })

  it('extracts phrased verification intentions', () => {
    const tools = extractPlannedTools('I should compile and run the tests to verify.')
    expect(tools.length).toBeGreaterThan(0)
  })

  it('returns empty for reasoning without verification intent', () => {
    const tools = extractPlannedTools('I will read the file and edit line 42.')
    // No verification-related tools mentioned
    expect(tools.every(t => !['pwsh', 'bash', 'run_code'].includes(t))).toBe(true)
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
      toolCallEvent('pwsh', 3),
    ]
    const signal = tracker.detectDrift(events, 0)
    expect(signal).toBeUndefined()
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
})
