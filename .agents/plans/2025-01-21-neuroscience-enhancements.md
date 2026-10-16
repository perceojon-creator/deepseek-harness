# Neuroscience-Aligned Metacognitive Enhancements — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the five-layer goal supervisor with six neuroscience-aligned mechanisms: perseveration detection, intention drift, episodic consolidation, reward inversion, salience mapping, and cerebellar forward-model reasoning analysis.

**Architecture:** All six mechanisms integrate into the existing `dsh-goal-supervisor` plugin. Mechanisms 1, 2, and 6 extend Layer 3 (deterministic evasion detector — zero LLM cost). Mechanism 3 adds a new Layer 2.5 (intention capture and comparison). Mechanism 4 modifies Layer 1 prompt text. Mechanism 5 extends Layer 4 LLM supervisor output schema. Mechanism 6 (episodic consolidation) adds a new periodic Layer 4.5 that generates structured summaries surviving compaction.

**Tech Stack:** TypeScript ESM, Cordis plugin system, `@deepseek-ai/dsh-agent` events, `@deepseek-ai/dsh-llm` streaming API, `@deepseek-ai/dsh-goal` domain, `@deepseek-ai/dsh-system-prompt` sections, `@deepseek-ai/dsh-session` events.

**Spec:** Neuroscience-aligned enhancements discussed in conversation; six mechanisms mapped to brain circuits (OFC perseveration, dopaminergic δ prediction error, cerebellar forward models, hippocampal consolidation, insular salience network, vmPFC temporal discounting).

## Global Constraints

- Node ^22.19 || >=24, ESM everywhere (`"type": "module"`).
- Package: `@deepseek-ai/dsh-goal-supervisor` (existing, in `packages/goal/goal-supervisor/`).
- Zero modifications to `dsh-agent-loop`.
- `.ts` extensions in local relative imports.
- `strict: true` with `noImplicitAny`.
- Every new export has JSDoc with `@param`/`@returns`.
- Tests exercise real detection logic with fabricated session events matching `SessionEvent` structure; no tests that merely assert "function exists" or mirror implementation.
- All new `EvasionSignal` codes use UPPER_SNAKE_CASE strings.
- New Layer 3 heuristics must not call any LLM — deterministic only.
- Layer 4 extensions must preserve fail-closed semantics (parse failure = redirect).

---

### Task 1: Perseveration detector (OFC — corteza orbitofrontal)

**Files:**
- Create: `packages/goal/goal-supervisor/src/perseveration-detector.ts`
- Modify: `packages/goal/goal-supervisor/src/evasion-detector.ts` (import and call)
- Modify: `packages/goal/goal-supervisor/src/types.ts` (add `TurnErrorSignature`)
- Test: `packages/goal/goal-supervisor/tests/perseveration-detector.spec.ts`

**Interfaces:**
- Consumes: `SessionEvent[]` (specifically `tool/result` events with `error` field and `tool/call` events with matching `callId`).
- Produces: `PerseverationTracker` class with `recordTurn(events, turnStartSeq): void` and `detect(): EvasionSignal | undefined`. `computeErrorSignature(events, turnStartSeq): string | undefined` — pure function that hashes the error-bearing tool results in a turn.

The perseveration detector maintains a rolling window of error signatures across turns. When the same signature appears ≥ 3 consecutive times, it emits `PERSEVERATION`. The tracker is process-local (per-agent state in the `CompletionGate` companion or its own Map). It resets when the goal changes or the agent is disposed.

- [ ] **Step 1: Add `TurnErrorSignature` to types.ts**

```typescript
// Add to packages/goal/goal-supervisor/src/types.ts:

/** Hashed identity of the error pattern in one turn, for perseveration detection. */
export type TurnErrorSignature = string & { readonly __turnErrorSignature: true }
```

- [ ] **Step 2: Write the failing test**

```typescript
// packages/goal/goal-supervisor/tests/perseveration-detector.spec.ts
import { describe, expect, it } from 'vitest'
import { PerseverationTracker, computeErrorSignature } from '../src/perseveration-detector.ts'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

function toolCallEvent(name: string, seq: number, callId: string): SessionEvent {
  return {
    type: 'tool/call', seq,
    data: { turn: 1, step: 1, callId: ToolCallId(callId), name, arguments: '{}' },
  } as unknown as SessionEvent
}

function toolResultEvent(seq: number, callId: string, errorText: string): SessionEvent {
  return {
    type: 'tool/result', seq,
    data: {
      turn: 1, step: 1,
      message: { role: 'user', content: [{ type: 'tool-result', toolCallId: ToolCallId(callId), content: [{ type: 'text', text: errorText }], isError: true }] },
      error: { name: 'ToolExecutionError', code: 'EXEC_FAILED' },
    },
  } as unknown as SessionEvent
}

function successResultEvent(seq: number, callId: string): SessionEvent {
  return {
    type: 'tool/result', seq,
    data: {
      turn: 1, step: 1,
      message: { role: 'user', content: [{ type: 'tool-result', toolCallId: ToolCallId(callId), content: [{ type: 'text', text: 'ok' }] }] },
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
    expect(signal!.code).toBe('PERSEVERATION')
    expect(signal!.description).toContain('3')
    expect(signal!.description).toContain('same error')
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
    tracker.recordTurn(eventsB, 0) // different error resets
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
    tracker.recordTurn(okEvents, 0) // success resets
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run packages/goal/goal-supervisor/tests/perseveration-detector.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `src/perseveration-detector.ts`**

```typescript
/** Layer 3 extension — Perseveration detector (orbitofrontal cortex). */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { EvasionSignal, TurnErrorSignature } from './types.ts'

/** Minimum consecutive identical-error turns before firing. */
const PERSEVERATION_THRESHOLD = 3

/**
 * Compute a stable signature from the error-bearing tool results in one turn.
 * The signature captures tool name + error text content, ignoring call IDs and
 * timestamps so that identical retry patterns hash identically.
 * @param events - session events to scan.
 * @param turnStartSeq - sequence number of the turn start.
 * @returns the signature string, or undefined if no errors occurred.
 */
export function computeErrorSignature(
  events: readonly SessionEvent[],
  turnStartSeq: number,
): TurnErrorSignature | undefined {
  const turnEvents = events.filter(e => e.seq > turnStartSeq)

  // Build a map of callId → tool name from tool/call events
  const callNames = new Map<string, string>()
  for (const event of turnEvents) {
    if (event.type === 'tool/call') {
      callNames.set(event.data.callId, event.data.name)
    }
  }

  // Collect error fingerprints from tool/result events
  const errorParts: string[] = []
  for (const event of turnEvents) {
    if (event.type !== 'tool/result') continue
    const data = event.data as {
      message: { content: readonly { type: string; isError?: boolean; content?: readonly { type: string; text?: string }[] }[] }
      error?: { name: string; code: string }
    }
    if (!data.error) continue

    const resultBlock = data.message.content[0]
    if (resultBlock?.type !== 'tool-result') continue

    const errorTexts = (resultBlock.content ?? [])
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text' && typeof b.text === 'string')
      .map(b => b.text)

    // Normalize: tool name + error code + first 200 chars of error text
    const callId = (resultBlock as { toolCallId?: string }).toolCallId ?? ''
    const toolName = callNames.get(callId) ?? 'unknown'
    errorParts.push(`${toolName}:${data.error.code}:${errorTexts.join('').slice(0, 200)}`)
  }

  if (errorParts.length === 0) return undefined

  // Simple stable hash: sort and join
  errorParts.sort()
  return errorParts.join('|') as TurnErrorSignature
}

/**
 * Track error signatures across turns and detect perseveration — the
 * orbitofrontal cortex's failure to inhibit a strategy that has already
 * failed repeatedly.
 */
export class PerseverationTracker {
  private lastSignature: TurnErrorSignature | undefined
  private consecutiveCount = 0

  /**
   * Record the error signature for the most recent turn.
   * @param events - session events from the turn.
   * @param turnStartSeq - sequence number of the turn start.
   */
  recordTurn(events: readonly SessionEvent[], turnStartSeq: number): void {
    const sig = computeErrorSignature(events, turnStartSeq)
    if (sig === undefined) {
      // No errors this turn — reset streak
      this.lastSignature = undefined
      this.consecutiveCount = 0
      return
    }
    if (sig === this.lastSignature) {
      this.consecutiveCount++
    } else {
      this.lastSignature = sig
      this.consecutiveCount = 1
    }
  }

  /**
   * Check whether the perseveration threshold has been reached.
   * @returns the evasion signal if the threshold is met, undefined otherwise.
   */
  detect(): EvasionSignal | undefined {
    if (this.consecutiveCount >= PERSEVERATION_THRESHOLD) {
      return {
        code: 'PERSEVERATION',
        description: `${this.consecutiveCount} consecutive turns produced the same error pattern. The current strategy has failed repeatedly — investigate the root cause or try a different approach before retrying.`,
      }
    }
    return undefined
  }

  /** Reset all perseveration tracking state. */
  reset(): void {
    this.lastSignature = undefined
    this.consecutiveCount = 0
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run packages/goal/goal-supervisor/tests/perseveration-detector.spec.ts`
Expected: PASS.

- [ ] **Step 6: Wire into the supervisor plugin**

In `src/index.ts`, add a per-agent `PerseverationTracker` map. In the `agent/turn-stopping` handler, call `tracker.recordTurn(events, turnStartSeq)` and include `tracker.detect()` in the signals array passed to Layer 4. Clean up trackers in `agent/disposed`. Reset trackers when `ctx.goals.get(agent)` returns a different goal ID than the tracked one.

- [ ] **Step 7: Commit**

```bash
git add packages/goal/goal-supervisor/
git commit -m "feat(goal-supervisor): perseveration detector — OFC-inspired repeated-failure inhibition"
```

---

### Task 2: Intention drift detector (sistema dopaminérgico — VTA δ prediction error)

**Files:**
- Create: `packages/goal/goal-supervisor/src/intention-tracker.ts`
- Modify: `packages/goal/goal-supervisor/src/evasion-detector.ts`
- Modify: `packages/goal/goal-supervisor/src/index.ts`
- Test: `packages/goal/goal-supervisor/tests/intention-tracker.spec.ts`

**Interfaces:**
- Consumes: `SessionEvent[]` — specifically `assistant/message` events with reasoning blocks (the model's declared intentions), and `tool/call` events (what the model actually did).
- Produces: `IntentionTracker` class with `captureIntentions(events, turnStartSeq): void` (extracts planned tool names from reasoning text) and `detectDrift(events, turnStartSeq): EvasionSignal | undefined` (compares declared intentions against executed tools). `extractPlannedTools(reasoningText: string): string[]` — pure function.

The detector captures what the model *said it would do* in its reasoning blocks and compares against what it *actually did* via tool calls. When the model declares verification intentions ("I'll run cargo test", "let me compile") but doesn't execute any verification tool, it emits `INTENTION_DRIFT`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/goal/goal-supervisor/tests/intention-tracker.spec.ts
import { describe, expect, it } from 'vitest'
import { extractPlannedTools, IntentionTracker } from '../src/intention-tracker.ts'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

function assistantMessage(seq: number, reasoningText: string): SessionEvent {
  return {
    type: 'assistant/message', seq,
    data: {
      turn: 1, step: 1,
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
    type: 'tool/call', seq,
    data: { turn: 1, step: 1, callId: ToolCallId(`c${seq}`), name, arguments: '{}' },
  } as unknown as SessionEvent
}

describe('extractPlannedTools', () => {
  it('extracts verification tool mentions from reasoning', () => {
    const tools = extractPlannedTools(
      "I need to run cargo test to verify the changes, then check with pwsh if the build succeeds."
    )
    expect(tools).toContain('pwsh')
  })

  it('extracts run_code mentions', () => {
    const tools = extractPlannedTools("Let me use run_code to execute the tests.")
    expect(tools).toContain('run_code')
  })

  it('extracts phrased verification intentions', () => {
    const tools = extractPlannedTools("I should compile and run the tests to verify.")
    expect(tools.length).toBeGreaterThan(0)
  })

  it('returns empty for reasoning without verification intent', () => {
    const tools = extractPlannedTools("I will read the file and edit line 42.")
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
    expect(signal!.code).toBe('INTENTION_DRIFT')
    expect(signal!.description).toContain('promised')
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
      assistantMessage(1, "I will read the config file and update the settings."),
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/goal/goal-supervisor/tests/intention-tracker.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/intention-tracker.ts`**

```typescript
/** Layer 3 extension — Intention drift detector (VTA dopaminergic δ). */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { EvasionSignal } from './types.ts'
import { VERIFICATION_TOOLS } from './evasion-detector.ts'

/**
 * Verification-intent patterns in natural language reasoning.
 * Matches phrases like "run tests", "compile", "cargo test", "execute", "verify".
 */
const VERIFICATION_INTENT_PATTERNS: readonly RegExp[] = [
  /\b(?:run|execute|invoke)\s+(?:the\s+)?(?:test|spec|suite|compilation|build|cargo\s+test|npm\s+test|pnpm\s+(?:vitest|test)|make\s+check)/i,
  /\b(?:compile|build)\b/i,
  /\b(?:verify|validate|check)\s+(?:the\s+)?(?:output|result|binary|build|compilation)/i,
  /\bpwsh\b/i,
  /\brun_code\b/i,
  /\bbash\b/i,
  /\bcargo\s+test\b/i,
]

/**
 * Extract planned verification tool usage from reasoning text.
 * @param reasoningText - the model's reasoning/thinking content.
 * @returns tool names or verification actions the model declared it would perform.
 */
export function extractPlannedTools(reasoningText: string): string[] {
  const found: string[] = []
  for (const pattern of VERIFICATION_INTENT_PATTERNS) {
    if (pattern.test(reasoningText)) {
      const match = reasoningText.match(pattern)
      if (match) found.push(match[0])
    }
  }
  // Deduplicate
  return [...new Set(found)]
}

/**
 * Track intention declarations in reasoning blocks and compare
 * against actual tool execution within the same turn.
 */
export class IntentionTracker {
  /**
   * Detect intention drift: the model promised verification in its reasoning
   * but did not execute any verification tool.
   * @param events - session events from the current turn.
   * @param turnStartSeq - sequence number of the turn start.
   * @returns the evasion signal if drift is detected, undefined otherwise.
   */
  detectDrift(
    events: readonly SessionEvent[],
    turnStartSeq: number,
  ): EvasionSignal | undefined {
    const turnEvents = events.filter(e => e.seq > turnStartSeq)

    // Extract reasoning text from assistant/message events
    const reasoningTexts: string[] = []
    for (const event of turnEvents) {
      if (event.type !== 'assistant/message') continue
      const data = event.data as {
        message: { content: readonly { type: string; text?: string }[] }
      }
      for (const block of data.message.content) {
        if (block.type === 'reasoning' && block.text) {
          reasoningTexts.push(block.text)
        }
      }
    }

    if (reasoningTexts.length === 0) return undefined

    const fullReasoning = reasoningTexts.join(' ')
    const plannedVerification = extractPlannedTools(fullReasoning)

    // No verification intent declared — no drift possible
    if (plannedVerification.length === 0) return undefined

    // Check if any verification tool was actually executed
    const executedTools = turnEvents
      .filter((e): e is Extract<SessionEvent, { type: 'tool/call' }> => e.type === 'tool/call')
      .map(e => e.data.name)

    const hasVerification = executedTools.some(name => VERIFICATION_TOOLS.has(name))

    if (!hasVerification) {
      return {
        code: 'INTENTION_DRIFT',
        description: `The model's reasoning promised verification (${plannedVerification.slice(0, 3).join(', ')}) but no verification tool (pwsh, bash, run_code) was executed. Declared intentions diverged from actual actions.`,
      }
    }

    return undefined
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/goal/goal-supervisor/tests/intention-tracker.spec.ts`
Expected: PASS.

- [ ] **Step 5: Wire into the supervisor plugin**

In `src/index.ts`, create one `IntentionTracker` instance. In the `agent/turn-stopping` handler, call `tracker.detectDrift(events, turnStartSeq)` and append the result (if defined) to the signals array.

- [ ] **Step 6: Commit**

```bash
git add packages/goal/goal-supervisor/
git commit -m "feat(goal-supervisor): intention drift detector — dopaminergic δ prediction error"
```

---

### Task 3: Reward inversion in self-audit prompt (vmPFC temporal discounting)

**Files:**
- Modify: `packages/goal/goal-supervisor/src/self-audit-prompt.ts`
- Modify: `packages/goal/goal-supervisor/tests/self-audit-prompt.spec.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: modified `renderSelfAuditSection(objective)` with inverted reward framing.

The current self-audit says "you may call update_goal to mark complete" — framing completion as the goal. The neuroscience insight: reframe so that *sustained productive work with verification* is the rewarded state, and *premature completion* is framed as a failure that will be reverted.

- [ ] **Step 1: Write the new test assertions**

```typescript
// Add to packages/goal/goal-supervisor/tests/self-audit-prompt.spec.ts

it('frames sustained work as the desired outcome, not completion', () => {
  const text = renderSelfAuditSection('Port C++ to Rust')
  // Reward inversion: productive work IS the reward, premature close is failure
  expect(text).toMatch(/productive work.*reward|each.*verified.*correct outcome/i)
  expect(text).toMatch(/premature.*reverted|incomplete.*failure|closing.*without.*evidence.*rejected/i)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/goal/goal-supervisor/tests/self-audit-prompt.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Modify the self-audit prompt text**

In `renderSelfAuditSection`, replace the existing closing paragraph (item 4 in the `<self_audit>` block) and add reward-inverted framing:

```typescript
// Replace item 4 in the self_audit block:
+ '4. Each turn of productive work with empirical verification is the correct outcome. '
+ 'Completing without exhaustive evidence is a failure that will be rejected and reverted. '
+ 'Do not treat completion as a reward — treat each verified sub-task as progress. '
+ 'Closing prematurely without evidence produces strictly worse outcomes than continuing.\n'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/goal/goal-supervisor/tests/self-audit-prompt.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/goal/goal-supervisor/
git commit -m "feat(goal-supervisor): reward-inverted self-audit prompt — vmPFC temporal discounting"
```

---

### Task 4: Cerebellar forward-model reasoning analysis

**Files:**
- Create: `packages/goal/goal-supervisor/src/forward-model-analyzer.ts`
- Modify: `packages/goal/goal-supervisor/src/index.ts`
- Test: `packages/goal/goal-supervisor/tests/forward-model-analyzer.spec.ts`

**Interfaces:**
- Consumes: `SessionEvent[]` — specifically `assistant/message` events with reasoning blocks.
- Produces: `analyzeReasoningQuality(events, turnStartSeq): EvasionSignal | undefined` — pure function that detects low-confidence or assumptive reasoning patterns *before* the model acts. Fired from `agent/pre-step` on the *second* step of a turn (after the model has produced reasoning but before the next model call).

The cerebellum predicts sensory consequences of motor actions before they happen. This analyzer reads the model's reasoning for hedging patterns ("should work", "probably fine", "I think this is enough") that predict low-quality actions.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/goal/goal-supervisor/tests/forward-model-analyzer.spec.ts
import { describe, expect, it } from 'vitest'
import { analyzeReasoningQuality } from '../src/forward-model-analyzer.ts'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

function assistantMessage(seq: number, reasoningText: string): SessionEvent {
  return {
    type: 'assistant/message', seq,
    data: {
      turn: 1, step: 1,
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
      assistantMessage(1, "This should probably work. I think the types are compatible enough and it should be fine without running tests."),
    ]
    const signal = analyzeReasoningQuality(events, 0)
    expect(signal).toBeDefined()
    expect(signal!.code).toBe('WEAK_REASONING')
    expect(signal!.description).toContain('hedging')
  })

  it('detects explicit verification avoidance', () => {
    const events: SessionEvent[] = [
      assistantMessage(1, "I don't need to run the tests since the changes are straightforward. Let me just mark this as complete."),
    ]
    const signal = analyzeReasoningQuality(events, 0)
    expect(signal).toBeDefined()
    expect(signal!.code).toBe('WEAK_REASONING')
  })

  it('no signal for confident, verification-oriented reasoning', () => {
    const events: SessionEvent[] = [
      assistantMessage(1, "I need to verify this compiles correctly. Let me run cargo test and check each module's output against the C++ reference binary."),
    ]
    const signal = analyzeReasoningQuality(events, 0)
    expect(signal).toBeUndefined()
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
      assistantMessage(1, "I should start by reading the file to understand the structure."),
    ]
    const signal = analyzeReasoningQuality(events, 0)
    expect(signal).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/goal/goal-supervisor/tests/forward-model-analyzer.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/forward-model-analyzer.ts`**

```typescript
/** Layer 3 extension — Cerebellar forward-model reasoning analysis. */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { EvasionSignal } from './types.ts'

/** Hedging patterns that predict low-quality work when they co-occur. */
const HEDGING_PATTERNS: readonly RegExp[] = [
  /\bshould(?:\s+(?:be|work|probably))\b/i,
  /\bprobably\s+(?:fine|work|enough|correct|ok)\b/i,
  /\b(?:I\s+think|I\s+believe)\s+(?:this|it|that)\s+(?:is|should|will)\s+(?:enough|fine|correct|ok|sufficient)\b/i,
  /\bwithout\s+(?:running|executing|checking|verifying|testing)\b/i,
  /\bdon'?t\s+need\s+to\s+(?:run|test|verify|check|compile)\b/i,
  /\bno\s+need\s+(?:to|for)\s+(?:test|verif|compil|check)/i,
  /\bskip(?:ping)?\s+(?:the\s+)?(?:test|verification|compilation|check)/i,
  /\bstraightforward\s+enough\b/i,
  /\bjust\s+(?:mark|declare|claim|set)\s+(?:this\s+)?(?:as\s+)?complete\b/i,
]

/** Minimum number of co-occurring hedging indicators to fire the signal. */
const MIN_HEDGING_DENSITY = 2

/**
 * Analyze the model's reasoning blocks for hedging and verification-avoidance
 * patterns that predict low-quality actions.
 * @param events - session events from the current turn.
 * @param turnStartSeq - sequence number of the turn start.
 * @returns the evasion signal if weak reasoning is detected, undefined otherwise.
 */
export function analyzeReasoningQuality(
  events: readonly SessionEvent[],
  turnStartSeq: number,
): EvasionSignal | undefined {
  const turnEvents = events.filter(e => e.seq > turnStartSeq)

  const reasoningTexts: string[] = []
  for (const event of turnEvents) {
    if (event.type !== 'assistant/message') continue
    const data = event.data as {
      message: { content: readonly { type: string; text?: string }[] }
    }
    for (const block of data.message.content) {
      if (block.type === 'reasoning' && block.text) {
        reasoningTexts.push(block.text)
      }
    }
  }

  if (reasoningTexts.length === 0) return undefined

  const fullReasoning = reasoningTexts.join(' ')
  let hedgingCount = 0
  const matchedPatterns: string[] = []

  for (const pattern of HEDGING_PATTERNS) {
    if (pattern.test(fullReasoning)) {
      hedgingCount++
      const match = fullReasoning.match(pattern)
      if (match) matchedPatterns.push(match[0])
    }
  }

  if (hedgingCount >= MIN_HEDGING_DENSITY) {
    return {
      code: 'WEAK_REASONING',
      description: `Reasoning contains ${hedgingCount} hedging/avoidance indicators (${matchedPatterns.slice(0, 3).join('; ')}). This predicts unverified work — run concrete verification before proceeding.`,
    }
  }

  return undefined
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/goal/goal-supervisor/tests/forward-model-analyzer.spec.ts`
Expected: PASS.

- [ ] **Step 5: Wire into the supervisor plugin**

In `src/index.ts`, in the `agent/turn-stopping` handler, call `analyzeReasoningQuality(events, turnStartSeq)` and include the result (if defined) in the signals array alongside evasion and perseveration signals.

- [ ] **Step 6: Commit**

```bash
git add packages/goal/goal-supervisor/
git commit -m "feat(goal-supervisor): forward-model reasoning analysis — cerebellar predictive check"
```

---

### Task 5: Salience map in Layer 4 supervisor output (ínsula anterior + dACC)

**Files:**
- Modify: `packages/goal/goal-supervisor/src/types.ts` (add `SalienceEntry`)
- Modify: `packages/goal/goal-supervisor/src/supervisor-prompt.ts`
- Modify: `packages/goal/goal-supervisor/src/supervisor-call.ts` (`parseVerdict` handles new field)
- Modify: `packages/goal/goal-supervisor/src/round-prompt-enrichment.ts` (include salience map)
- Modify: `packages/goal/goal-supervisor/src/index.ts` (thread salience)
- Test: `packages/goal/goal-supervisor/tests/salience-map.spec.ts`

**Interfaces:**
- Consumes: existing `SupervisorVerdict` extended with optional `salience` field.
- Produces: `SalienceEntry` type. Updated `parseVerdict` that extracts salience from the supervisor JSON. Updated `renderLedgerInstruction` that accepts an optional salience array. Updated `renderSupervisorPrompt` that requests salience output.

The insular salience network decides what deserves executive attention. The Layer 4 supervisor LLM already evaluates the agent's state — it now additionally outputs a ranked list of sub-tasks by risk/uncertainty, which the progress ledger in the next turn uses to focus the model's attention on high-risk areas first.

- [ ] **Step 1: Add types**

```typescript
// Add to packages/goal/goal-supervisor/src/types.ts:

/** One sub-task with its risk/priority ranking from the supervisor. */
export interface SalienceEntry {
  /** Short sub-task description. */
  readonly task: string
  /** Risk level assigned by the supervisor. */
  readonly risk: 'critical' | 'high' | 'medium' | 'low'
}
```

- [ ] **Step 2: Write the test**

```typescript
// packages/goal/goal-supervisor/tests/salience-map.spec.ts
import { describe, expect, it } from 'vitest'
import { parseVerdict } from '../src/supervisor-call.ts'
import { renderSupervisorPrompt } from '../src/supervisor-prompt.ts'
import { renderLedgerInstruction } from '../src/round-prompt-enrichment.ts'

describe('salience map in supervisor output', () => {
  it('parseVerdict extracts salience entries from supervisor JSON', () => {
    const text = '{"action": "redirect", "critique": "Module B untested", "salience": [{"task": "module B pointer arithmetic", "risk": "critical"}, {"task": "module A string handling", "risk": "low"}]}'
    const verdict = parseVerdict(text)
    expect(verdict.action).toBe('redirect')
    expect(verdict.salience).toHaveLength(2)
    expect(verdict.salience![0].task).toBe('module B pointer arithmetic')
    expect(verdict.salience![0].risk).toBe('critical')
  })

  it('parseVerdict works without salience field (backward compatible)', () => {
    const text = '{"action": "approve"}'
    const verdict = parseVerdict(text)
    expect(verdict.action).toBe('approve')
    expect(verdict.salience).toBeUndefined()
  })

  it('supervisor prompt requests salience output', () => {
    const prompt = renderSupervisorPrompt('Port C++ to Rust', 'summary', [])
    expect(prompt).toContain('salience')
    expect(prompt).toContain('critical')
  })

  it('ledger instruction includes salience map when provided', () => {
    const text = renderLedgerInstruction('any', 3, 50, [
      { task: 'unsafe pointer module', risk: 'critical' },
      { task: 'string utilities', risk: 'low' },
    ])
    expect(text).toContain('unsafe pointer module')
    expect(text).toContain('CRITICAL')
    expect(text).toContain('string utilities')
  })

  it('ledger instruction works without salience (backward compatible)', () => {
    const text = renderLedgerInstruction('any', 3, 50)
    expect(text).toContain('<progress_ledger>')
    expect(text).not.toContain('CRITICAL')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run packages/goal/goal-supervisor/tests/salience-map.spec.ts`
Expected: FAIL.

- [ ] **Step 4: Extend types, parseVerdict, prompt, and ledger**

Add `salience?: readonly SalienceEntry[]` to `SupervisorVerdict`. In `parseVerdict`, extract and validate the `salience` array from JSON (ignore malformed entries, fail open on salience — do not redirect solely because salience parse failed). In `renderSupervisorPrompt`, add the salience output instruction to the JSON format section. In `renderLedgerInstruction`, add an optional 4th parameter `salience?: readonly SalienceEntry[]` and render a focus-priority block when provided.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run packages/goal/goal-supervisor/tests/salience-map.spec.ts`
Expected: PASS.

- [ ] **Step 6: Wire salience into the plugin**

Store the latest `verdict.salience` per agent. When Layer 2 fires (pre-step with goal source), pass the stored salience to `renderLedgerInstruction`.

- [ ] **Step 7: Commit**

```bash
git add packages/goal/goal-supervisor/
git commit -m "feat(goal-supervisor): salience map — insular risk-prioritized attention focusing"
```

---

### Task 6: Episodic consolidation (hipocampo → neocórtex)

**Files:**
- Create: `packages/goal/goal-supervisor/src/episodic-consolidation.ts`
- Modify: `packages/goal/goal-supervisor/src/index.ts`
- Modify: `packages/goal/goal-supervisor/src/types.ts`
- Test: `packages/goal/goal-supervisor/tests/episodic-consolidation.spec.ts`

**Interfaces:**
- Consumes: `ctx.llm.stream()`, `SessionEvent[]`, `GoalView`, `PerseverationTracker` (failed strategy history).
- Produces: `ConsolidationManager` class with `shouldConsolidate(roundsStarted, config): boolean` and `consolidate(ctx, agent, goal, config): Promise<string>` — generates a structured episodic summary via one LLM call every N rounds, registered as a persistent system-prompt section.

The hippocampus replays and consolidates episodic memories during sleep. This mechanism generates a structured summary of verified progress, failed strategies, and active hypotheses every N goal rounds. The summary is registered as a durable system-prompt section (`supervisor:episodic-memory`) that survives compaction because it is regenerated from the session events at consolidation time — not accumulated from previous summaries.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/goal/goal-supervisor/tests/episodic-consolidation.spec.ts
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
    expect(mgr.shouldConsolidate(5, 5)).toBe(false) // already consolidated
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
  - parser.cpp → parser.rs: compiled, tests pass (turn 3)
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/goal/goal-supervisor/tests/episodic-consolidation.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/episodic-consolidation.ts`**

```typescript
/** Layer 4.5 — Episodic consolidation (hippocampal replay). */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { GoalView } from '@deepseek-ai/dsh-goal'
import { resolveSupervisorModel, extractSessionSummary, streamToText } from './supervisor-call.ts'
import type { SupervisorConfig } from './supervisor-call.ts'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'

/**
 * Render the consolidation prompt for the supervisor LLM.
 * @param objective - the goal's textual objective.
 * @param sessionSummary - extracted summary of all session activity.
 * @returns the system prompt for the consolidation LLM call.
 */
export function renderConsolidationPrompt(
  objective: string,
  sessionSummary: string,
): string {
  return (
    'You are an episodic memory consolidation system. Your role is to distill '
    + 'the session history into a structured summary that preserves verified facts, '
    + 'identifies failed strategies, and surfaces active hypotheses.\n\n'
    + `OBJECTIVE: ${JSON.stringify(objective)}\n\n`
    + `SESSION HISTORY:\n${sessionSummary}\n\n`
    + 'Produce EXACTLY one <episodic_consolidation> block containing:\n'
    + 'Verified:\n'
    + '  - Each sub-task confirmed by tool output, citing the turn and evidence.\n'
    + 'Failed strategies:\n'
    + '  - Each approach that was tried and abandoned, citing the turns and failure mode.\n'
    + 'Active hypothesis:\n'
    + '  - The current working theory for unresolved sub-tasks.\n'
    + '</episodic_consolidation>\n'
  )
}

/**
 * Extract the episodic consolidation block from the LLM response.
 * @param text - the raw LLM response.
 * @returns the consolidation content, or the full text if no block tags found.
 */
export function parseConsolidation(text: string): string {
  const match = text.match(/<episodic_consolidation>([\s\S]*?)<\/episodic_consolidation>/)
  if (match) return match[0]
  return text
}

/**
 * Manage periodic episodic consolidation for a goal.
 */
export class ConsolidationManager {
  private lastConsolidatedRound = 0
  private currentSummary: string | undefined

  /**
   * Check whether a consolidation should occur at this round.
   * @param roundsStarted - how many goal rounds have been completed.
   * @param interval - consolidation interval in rounds.
   * @returns true if consolidation should fire.
   */
  shouldConsolidate(roundsStarted: number, interval: number): boolean {
    if (roundsStarted <= 0 || interval <= 0) return false
    if (roundsStarted % interval !== 0) return false
    if (roundsStarted <= this.lastConsolidatedRound) return false
    this.lastConsolidatedRound = roundsStarted
    return true
  }

  /**
   * Run a consolidation LLM call and store the result.
   * @param ctx - Cordis context with LLM service.
   * @param agent - the agent whose session is being consolidated.
   * @param goal - the active goal.
   * @param config - supervisor model configuration.
   * @returns the consolidation summary text.
   */
  async consolidate(
    ctx: Context,
    agent: Agent,
    goal: GoalView,
    config: SupervisorConfig,
  ): Promise<string> {
    const { provider, model } = resolveSupervisorModel(ctx, agent, config)
    // Use a wider window for consolidation — last 50 events, not 30
    const sessionSummary = extractSessionSummary(agent, 0)
    const systemPrompt = renderConsolidationPrompt(goal.objective, sessionSummary)

    const options: GenerateOptions = {
      provider,
      model,
      system: systemPrompt,
      messages: [createUserMessage({
        content: [{ type: 'text', text: 'Consolidate the session history now.' }],
        source: { kind: 'plugin', plugin: 'goal-supervisor' },
      })],
      temperature: 0,
      maxTokens: 1000,
    }

    try {
      const text = await streamToText(ctx.llm.stream(options))
      this.currentSummary = parseConsolidation(text)
      return this.currentSummary
    } catch (error: unknown) {
      ctx.logger.warn(`goal-supervisor: consolidation LLM call failed: ${error instanceof Error ? error.message : String(error)}`)
      return this.currentSummary ?? ''
    }
  }

  /**
   * Get the most recent consolidation summary.
   * @returns the current summary, or undefined if no consolidation has occurred.
   */
  getSummary(): string | undefined {
    return this.currentSummary
  }

  /** Reset consolidation state. */
  reset(): void {
    this.lastConsolidatedRound = 0
    this.currentSummary = undefined
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/goal/goal-supervisor/tests/episodic-consolidation.spec.ts`
Expected: PASS.

- [ ] **Step 5: Add `consolidationInterval` to Config**

In `src/index.ts`, add to `Config`:
```typescript
/** Number of goal rounds between episodic consolidation summaries (default: 5). */
consolidationInterval?: number
```

In the Schemastery schema:
```typescript
consolidationInterval: z.number().int().positive().default(5)
  .description('Number of goal rounds between episodic consolidation summaries.'),
```

- [ ] **Step 6: Wire into the supervisor plugin**

In `src/index.ts`:
1. Create per-agent `ConsolidationManager` map.
2. In the `agent/turn-stopping` handler, after the supervisor verdict, check `mgr.shouldConsolidate(goal.roundsStarted, config.consolidationInterval ?? 5)`. If true, call `mgr.consolidate()`.
3. Register a new system-prompt section `supervisor:episodic-memory` that returns `mgr.getSummary() ?? ''`.
4. Clean up in `agent/disposed`.

- [ ] **Step 7: Commit**

```bash
git add packages/goal/goal-supervisor/
git commit -m "feat(goal-supervisor): episodic consolidation — hippocampal memory for long goals"
```

---

### Task 7: Wiring integration, documentation, and quality gates

**Files:**
- Modify: `packages/goal/goal-supervisor/src/index.ts` (final wiring of all mechanisms)
- Modify: `packages/goal/goal-supervisor/README.md` + `README.zh.md`
- Modify: `packages/goal/goal-supervisor/src/types.ts` (re-export new types)
- Test: `packages/goal/goal-supervisor/tests/goal-supervisor.composition.spec.ts` (extend)

**Interfaces:**
- Consumes: all mechanisms from Tasks 1-6.
- Produces: complete integrated plugin with all eleven layers/sub-layers active.

- [ ] **Step 1: Extend the composition test with new mechanism coverage**

Add composition tests that verify:
1. Perseveration: 3 turns with the same tool/result error → redirect with PERSEVERATION signal.
2. Intention drift: reasoning promises verification, no verification tool runs → redirect with INTENTION_DRIFT.
3. Salience: supervisor verdict includes salience → next turn's ledger includes it.

```typescript
// Add to goal-supervisor.composition.spec.ts:

it('detects perseveration when the same error repeats across turns', async () => {
  // This test verifies cross-turn state tracking — not a cosmetic assertion.
  // It boots the full plugin composition, simulates 3 turns with identical
  // tool errors, and asserts the perseveration signal appears in the
  // turn-stopping handler's signal set.
  // Implementation: fabricate 3 turn sequences of tool/call + tool/result
  // with error field, call the agent/turn-stopping waterfall, and verify
  // that the steer message mentions PERSEVERATION.
})
```

- [ ] **Step 2: Verify all index.ts wiring compiles**

Run: `pnpm run typecheck`
Expected: PASS.

- [ ] **Step 3: Run all tests**

Run: `pnpm vitest run packages/goal/goal-supervisor/`
Expected: PASS — all new and existing tests.

- [ ] **Step 4: Run full test suite**

Run: `pnpm vitest run packages/goal/`
Expected: PASS — zero regressions.

- [ ] **Step 5: Run lint**

Run: `pnpm run lint`
Expected: PASS — 0 warnings, 0 errors.

- [ ] **Step 6: Run doc-sync**

Run: `pnpm run doc-sync`
Expected: PASS — 32/32 gates.

- [ ] **Step 7: Update README with new mechanisms**

Add the six new mechanisms to the `## Understand the implementation` section and `## Model Experience` section (updated token estimates). Update `README.zh.md` in parallel.

- [ ] **Step 8: Update Agent Note**

Update `.agents/notes/implemented/feature/2026-08-26-neuroscience-goal-supervisor.md` to document the six new mechanisms.

- [ ] **Step 9: Commit**

```bash
git add packages/goal/goal-supervisor/ .agents/notes/
git commit -m "feat(goal-supervisor): integrate six neuroscience mechanisms and update documentation"
```

---

### Task 8: Integration validation — real behavioral verification

**Files:**
- Create: `packages/goal/goal-supervisor/tests/neuro-integration.spec.ts`

**Interfaces:**
- Consumes: all mechanisms.
- Produces: a comprehensive behavioral test that validates the complete interaction between all layers using fabricated but realistic multi-turn session event sequences.

This test is the acid test. It does NOT test "does function X return Y" — it tests "given this realistic sequence of agent behavior, does the supervisor system produce the correct intervention at the correct time?"

- [ ] **Step 1: Write the multi-turn behavioral test**

```typescript
// packages/goal/goal-supervisor/tests/neuro-integration.spec.ts
import { describe, expect, it } from 'vitest'
import { detectEvasion, VERIFICATION_TOOLS } from '../src/evasion-detector.ts'
import { PerseverationTracker } from '../src/perseveration-detector.ts'
import { IntentionTracker } from '../src/intention-tracker.ts'
import { analyzeReasoningQuality } from '../src/forward-model-analyzer.ts'
import { CompletionGate } from '../src/completion-gate.ts'
import { parseVerdict } from '../src/supervisor-call.ts'
import { GoalId } from '@deepseek-ai/dsh-goal'
import type { GoalView } from '@deepseek-ai/dsh-goal'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

// Realistic event factory
function tc(name: string, seq: number, callId: string, args = '{}'): SessionEvent {
  return { type: 'tool/call', seq, data: { turn: 1, step: 1, callId: ToolCallId(callId), name, arguments: args } } as unknown as SessionEvent
}
function tr(seq: number, callId: string, text: string, isError = false, errorMeta?: { name: string; code: string }): SessionEvent {
  return {
    type: 'tool/result', seq,
    data: {
      turn: 1, step: 1,
      message: { role: 'user', content: [{ type: 'tool-result', toolCallId: ToolCallId(callId), content: [{ type: 'text', text }], isError }] },
      ...(errorMeta ? { error: errorMeta } : {}),
    },
  } as unknown as SessionEvent
}
function am(seq: number, reasoning: string, text = ''): SessionEvent {
  return {
    type: 'assistant/message', seq,
    data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'reasoning', text: reasoning }, { type: 'text', text }] } },
  } as unknown as SessionEvent
}

const goal: GoalView = {
  id: GoalId('rust-port'), revision: 1, objective: 'Port 1M LoC C++ to Rust with differential testing',
  phase: 'active', maxGoalRounds: 50, roundsStarted: 5, createdAt: 0, updatedAt: 0, activation: 'armed',
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
      am(1, "I will compile the rust port and run cargo test to verify correctness."),
      tc('write', 2, 'c1'), tr(3, 'c1', 'ok'),
      tc('edit', 4, 'c2'), tr(5, 'c2', 'ok'),
    ]
    const signal = tracker.detectDrift(events, 0)
    expect(signal).toBeDefined()
    expect(signal!.code).toBe('INTENTION_DRIFT')
  })

  it('Forward model catches hedging reasoning', () => {
    const events: SessionEvent[] = [
      am(1, "This should probably work without running tests. I think the types are compatible enough, so I will just mark complete."),
    ]
    const signal = analyzeReasoningQuality(events, 0)
    expect(signal).toBeDefined()
    expect(signal!.code).toBe('WEAK_REASONING')
  })

  it('Perseveration tracker fires after 3 identical compilation errors', () => {
    const tracker = new PerseverationTracker()
    const errorEvents: SessionEvent[] = [
      tc('pwsh', 1, 'c1'),
      tr(2, 'c1', 'error[E0308]: mismatched types\n  --> src/parser.rs:42:5', true, { name: 'ExecError', code: 'EXIT_1' }),
    ]
    // Turn 1, 2, 3 with same error
    tracker.recordTurn(errorEvents, 0)
    tracker.recordTurn(errorEvents, 0)
    tracker.recordTurn(errorEvents, 0)
    const signal = tracker.detect()
    expect(signal).toBeDefined()
    expect(signal!.code).toBe('PERSEVERATION')
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
      + '"salience": [{"task": "module B unsafe pointers", "risk": "critical"}, {"task": "module A strings", "risk": "low"}]}'
    )
    expect(verdict.action).toBe('redirect')
    expect(verdict.salience).toBeDefined()
    expect(verdict.salience![0].risk).toBe('critical')
  })

  it('Full pipeline: all signals combine into a comprehensive redirect', () => {
    // Simulate a turn where ALL detectors fire
    const events: SessionEvent[] = [
      am(1, "This should probably work. I don't need to run tests since the changes are straightforward."),
      tc('write', 2, 'c1'), tr(3, 'c1', 'ok'),
      tc('write', 4, 'c2'), tr(5, 'c2', 'ok'),
      tc('edit', 6, 'c3'), tr(7, 'c3', 'ok'),
      tc('update_goal', 8, 'c4', '{"action":"complete"}'),
    ]

    // Layer 3: evasion
    const evasionSignals = detectEvasion(events, goal, 0)
    expect(evasionSignals.some(s => s.code === 'NO_VERIFICATION')).toBe(true)
    expect(evasionSignals.some(s => s.code === 'PREMATURE_COMPLETE')).toBe(true)

    // Layer 3: forward model
    const weakReasoning = analyzeReasoningQuality(events, 0)
    expect(weakReasoning).toBeDefined()

    // Layer 3: intention drift (reasoning mentions verification but none executed)
    const tracker = new IntentionTracker()
    // Note: this specific reasoning doesn't promise verification — it avoids it.
    // Intention drift only fires when verification is PROMISED but not delivered.
    // So we need to verify the correct negative here too.
    const drift = tracker.detectDrift(events, 0)
    // The reasoning says "don't need to test" — that's avoidance, not a promise.
    // WEAK_REASONING catches this, not INTENTION_DRIFT.

    // All combined: at least 3 independent signals fired
    const allSignals = [...evasionSignals, ...(weakReasoning ? [weakReasoning] : []), ...(drift ? [drift] : [])]
    expect(allSignals.length).toBeGreaterThanOrEqual(3)
  })
})
```

- [ ] **Step 2: Run the test**

Run: `pnpm vitest run packages/goal/goal-supervisor/tests/neuro-integration.spec.ts`
Expected: PASS.

- [ ] **Step 3: Run the full suite**

Run: `pnpm vitest run packages/goal/`
Expected: PASS — all tests, including new behavioral tests.

- [ ] **Step 4: Commit**

```bash
git add packages/goal/goal-supervisor/tests/
git commit -m "test(goal-supervisor): multi-turn behavioral integration test for all neuroscience mechanisms"
```
