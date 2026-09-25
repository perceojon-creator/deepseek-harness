import { describe, expect, it } from 'vitest'
import { detectEvasion } from '../src/evasion-detector.ts'
import { PerseverationTracker } from '../src/perseveration-detector.ts'
import { IntentionTracker } from '../src/intention-tracker.ts'
import { analyzeReasoningQuality } from '../src/forward-model-analyzer.ts'
import { CompletionGate } from '../src/completion-gate.ts'
import { parseVerdict } from '../src/supervisor-call.ts'
import { GoalId } from '@deepseek-ai/dsh-goal'
import type { GoalView } from '@deepseek-ai/dsh-goal'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

function tc(name: string, seq: number, callId: string, args = '{}'): SessionEvent {
  return {
    type: 'tool/call',
    seq,
    data: { turn: 1, step: 1, callId: ToolCallId(callId), name, arguments: args },
  } as unknown as SessionEvent
}

function tr(
  seq: number,
  callId: string,
  text: string,
  isError = false,
  errorMeta?: { name: string; code: string },
): SessionEvent {
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
            content: [{ type: 'text', text }],
            isError,
          },
        ],
      },
      ...(errorMeta ? { error: errorMeta } : {}),
    },
  } as unknown as SessionEvent
}

function am(seq: number, reasoning: string, text = ''): SessionEvent {
  return {
    type: 'assistant/message',
    seq,
    data: {
      turn: 1,
      step: 1,
      message: {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: reasoning },
          { type: 'text', text },
        ],
      },
    },
  } as unknown as SessionEvent
}

const goal: GoalView = {
  id: GoalId('rust-port'),
  revision: 1,
  objective: 'Port 1M LoC C++ to Rust with differential testing',
  phase: 'active',
  maxGoalRounds: 50,
  roundsStarted: 5,
  createdAt: 0,
  updatedAt: 0,
  activation: 'armed',
}

describe('Scenario: model writes code, promises tests, skips them, retries same error 3x', () => {
  it('Layer 3 detects NO_VERIFICATION on a write-heavy turn', () => {
    const events: SessionEvent[] = [
      tc('write', 1, 'c1'), tr(2, 'c1', 'ok'),
      tc('write', 3, 'c2'), tr(4, 'c2', 'ok'),
      tc('edit', 5, 'c3'), tr(6, 'c3', 'ok'),
      tc('write', 7, 'c4'), tr(8, 'c4', 'ok'),
    ]
    const signals = detectEvasion(events, goal, 0)
    expect(signals.some(s => s.code === 'NO_VERIFICATION')).toBe(true)
  })

  it('Intention tracker catches verification promise with no follow-through', () => {
    const tracker = new IntentionTracker()
    const events: SessionEvent[] = [
      am(1, 'I will compile the rust port and run cargo test to verify correctness.'),
      tc('write', 2, 'c1'), tr(3, 'c1', 'ok'),
      tc('edit', 4, 'c2'), tr(5, 'c2', 'ok'),
    ]
    const signal = tracker.detectDrift(events, 0)
    expect(signal).toBeDefined()
    expect(signal?.code).toBe('INTENTION_DRIFT')
  })

  it('Forward model catches hedging reasoning', () => {
    const events: SessionEvent[] = [
      am(1, 'This should probably work without running tests. I think the types are compatible enough, so I will just mark complete.'),
    ]
    const signal = analyzeReasoningQuality(events, 0)
    expect(signal).toBeDefined()
    expect(signal?.code).toBe('WEAK_REASONING')
  })

  it('Perseveration tracker fires after 3 identical compilation errors', () => {
    const tracker = new PerseverationTracker()
    const errorEvents: SessionEvent[] = [
      tc('pwsh', 1, 'c1'),
      tr(2, 'c1', 'error[E0308]: mismatched types\n  --> src/parser.rs:42:5', true, { name: 'ExecError', code: 'EXIT_1' }),
    ]
    tracker.recordTurn(errorEvents, 0)
    tracker.recordTurn(errorEvents, 0)
    tracker.recordTurn(errorEvents, 0)
    const signal = tracker.detect()
    expect(signal).toBeDefined()
    expect(signal?.code).toBe('PERSEVERATION')
  })

  it('Completion gate blocks after reset even if previously approved', () => {
    const gate = new CompletionGate()
    gate.approve('agent-1')
    expect(gate.canComplete('agent-1')).toBe(true)
    gate.resetTurn('agent-1')
    expect(gate.canComplete('agent-1')).toBe(false)
  })

  it('Salience map is extracted from supervisor verdict', () => {
    const verdict = parseVerdict(
      '{"action": "redirect", "critique": "Module B has unsafe pointer arithmetic untested", '
      + '"salience": [{"task": "module B unsafe pointers", "risk": "critical"}, {"task": "module A strings", "risk": "low"}]}',
    )
    expect(verdict.action).toBe('redirect')
    expect(verdict.salience).toBeDefined()
    expect(verdict.salience?.[0]?.risk).toBe('critical')
  })

  it('Full pipeline: all signals combine into a comprehensive redirect', () => {
    const events: SessionEvent[] = [
      am(1, "This should probably work. I don't need to run tests since the changes are straightforward."),
      tc('write', 2, 'c1'), tr(3, 'c1', 'ok'),
      tc('write', 4, 'c2'), tr(5, 'c2', 'ok'),
      tc('edit', 6, 'c3'), tr(7, 'c3', 'ok'),
      tc('update_goal', 8, 'c4', '{"action":"complete"}'),
    ]

    const evasionSignals = detectEvasion(events, goal, 0)
    expect(evasionSignals.some(s => s.code === 'NO_VERIFICATION')).toBe(true)
    expect(evasionSignals.some(s => s.code === 'PREMATURE_COMPLETE')).toBe(true)

    const weakReasoning = analyzeReasoningQuality(events, 0)
    expect(weakReasoning).toBeDefined()

    const tracker = new IntentionTracker()
    const drift = tracker.detectDrift(events, 0)

    const allSignals = [...evasionSignals, ...(weakReasoning ? [weakReasoning] : []), ...(drift ? [drift] : [])]
    expect(allSignals.length).toBeGreaterThanOrEqual(3)
  })
})
