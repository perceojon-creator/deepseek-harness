# Goal Supervisor — Neuroscience-Aligned Metacognitive Monitor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a five-layer metacognitive supervisor that prevents flash models from prematurely completing long-running goal objectives, inspired by ACC/dlPFC neuroscience and integrated into the existing goal subsystem.

**Architecture:** A new Cordis plugin `dsh-goal-supervisor` hooks into agent lifecycle events (`agent/turn-stopping`, `agent/pre-step`, `tools/post-execute`) to enforce continuous metacognitive oversight during active goals. Layer 1 (system prompt) and Layer 2 (goal-round prompt) embed self-audit obligations directly into the model's own reasoning. Layer 3 (deterministic pattern detector) catches evasion signals without LLM cost. Layer 4 (LLM supervisor call) fires only when Layer 3 triggers or the model attempts to close a turn, reading reasoning blocks and session history to produce specific critique injected as system-prompt context (same-self, not external voice). Layer 5 (hard gate) blocks `update_goal(complete)` unless the supervisor has certified the turn. Supervisor model selection cascades: configured provider/model → session's active model.

**Tech Stack:** TypeScript ESM, Cordis plugin system, `@deepseek-ai/dsh-agent` events, `@deepseek-ai/dsh-llm` streaming API, `@deepseek-ai/dsh-goal` domain, `@deepseek-ai/dsh-system-prompt` sections, `@deepseek-ai/dsh-tools` post-execute waterfall.

**Spec:** Design approved in brainstorming session — five-layer neuroscience-aligned metacognitive architecture.

## Global Constraints

- Node ^22.19 || >=24, ESM everywhere (`"type": "module"`).
- Package naming: `@deepseek-ai/dsh-goal-supervisor`.
- `@deepseek-ai/cordis` is a peerDependency (+ dev).
- Every package owns `./invariant`. Tests under `tests/`, not `src/__tests__/`.
- Plugin exports: named-export `name` / `inject` / `Config` / `apply`, no default export.
- Registrations are effects via `ctx.effect()` / `ctx.on()`.
- Zero modifications to `dsh-agent-loop`.
- `.ts` extensions in local relative imports.
- `strict: true` with `noImplicitAny`.

---

### Task 1: Scaffold the `dsh-goal-supervisor` package

**Files:**
- Create: `packages/goal/goal-supervisor/package.json`
- Create: `packages/goal/goal-supervisor/tsconfig.json`
- Create: `packages/goal/goal-supervisor/tsdown.config.ts`
- Create: `packages/goal/goal-supervisor/src/types.ts`
- Create: `packages/goal/goal-supervisor/src/invariant.ts`
- Create: `packages/goal/goal-supervisor/src/index.ts` (minimal skeleton)
- Create: `packages/goal/goal-supervisor/README.md` (stub)
- Create: `packages/goal/goal-supervisor/README.i18n.yaml`

**Interfaces:**
- Consumes: nothing yet.
- Produces: `SupervisorVerdict` type, `Config` schema, `name`, `inject`, `apply` exports.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "@deepseek-ai/dsh-goal-supervisor",
  "description": "Neuroscience-aligned metacognitive goal supervisor with five-layer verification",
  "version": "0.1.2-alpha.1",
  "publishConfig": { "access": "public" },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/deepseek-ai/deepseek-harness.git",
    "directory": "packages/goal/goal-supervisor"
  },
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/types/index.d.ts",
  "exports": {
    ".": {
      "types": "./lib/types/index.d.ts",
      "default": "./lib/index.js"
    },
    "./invariant": {
      "types": "./lib/types/invariant.d.ts",
      "default": "./lib/invariant.js"
    },
    "./src/*": "./src/*",
    "./package.json": "./package.json"
  },
  "files": [
    "lib/index.js",
    "lib/invariant.js",
    "lib/types/**/*.d.ts"
  ],
  "license": "MIT",
  "peerDependencies": {
    "@deepseek-ai/dsh-agent": "workspace:^",
    "@deepseek-ai/dsh-goal": "workspace:^",
    "@deepseek-ai/dsh-invariants": "workspace:^",
    "@deepseek-ai/dsh-llm": "workspace:^",
    "@deepseek-ai/dsh-session": "workspace:^",
    "@deepseek-ai/dsh-system-prompt": "workspace:^",
    "@deepseek-ai/dsh-tools": "workspace:^",
    "@deepseek-ai/cordis": "workspace:^"
  },
  "dependencies": {
    "@deepseek-ai/schemastery": "workspace:^"
  },
  "devDependencies": {
    "@deepseek-ai/cordis-plugin-loader": "workspace:^",
    "@deepseek-ai/dsh-agent": "workspace:^",
    "@deepseek-ai/dsh-agent-loop": "workspace:^",
    "@deepseek-ai/dsh-agent-loop-testkit": "workspace:^",
    "@deepseek-ai/dsh-goal": "workspace:^",
    "@deepseek-ai/dsh-invariants": "workspace:^",
    "@deepseek-ai/dsh-llm": "workspace:^",
    "@deepseek-ai/dsh-session": "workspace:^",
    "@deepseek-ai/dsh-system-prompt": "workspace:^",
    "@deepseek-ai/dsh-tools": "workspace:^",
    "@deepseek-ai/cordis": "workspace:^"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

Follow the `tool-goal` pattern: extend `tsconfig.base.json`, set `rootDir: src`, `outDir: lib/types`, and add workspace dependency project references including `runtime-diagnostics/invariants`.

- [ ] **Step 3: Create `tsdown.config.ts`**

Copy from `packages/goal/goal-round-driver/tsdown.config.ts` — same bundler config.

- [ ] **Step 4: Create `src/types.ts`**

```typescript
/** Pure types for the goal supervisor — no runtime code. */

/** Supervisor's evaluation of the agent's current state. */
export type SupervisorAction = 'approve' | 'redirect'

/** Result of one supervisor evaluation. */
export interface SupervisorVerdict {
  /** Whether to allow the turn to close or redirect the model. */
  readonly action: SupervisorAction
  /** Specific critique when action is 'redirect'. */
  readonly critique?: string
  /** Layer that originated this verdict (3 = deterministic, 4 = LLM). */
  readonly layer: 3 | 4
}

/** Evasion signal detected by Layer 3 deterministic analysis. */
export interface EvasionSignal {
  /** Machine-routable signal code. */
  readonly code: string
  /** Human-readable explanation. */
  readonly description: string
}
```

- [ ] **Step 5: Create `src/invariant.ts`**

```typescript
/**
 * Invariant companion for dsh-goal-supervisor.
 * No runtime invariant: supervisor verdicts are transient process-local
 * observations; the goal domain owns durable mutation validation.
 */
import { registerPackageInvariant } from '@deepseek-ai/dsh-invariants'

registerPackageInvariant(
  '@deepseek-ai/dsh-goal-supervisor',
  () => {},
  'No runtime invariant: the supervisor emits transient process-local verdicts; the goal domain owns durable mutation validation.',
)
```

- [ ] **Step 6: Create minimal `src/index.ts` skeleton**

```typescript
/**
 * Neuroscience-aligned metacognitive goal supervisor.
 * @module @deepseek-ai/dsh-goal-supervisor
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

export const name = 'goal-supervisor'
export const inject = ['agents', 'goals', 'llm', 'systemPrompt', 'tools']

export interface Config {
  supervisorProvider?: string
  supervisorModel?: string
}

export const Config: z<Config> = z.object({
  supervisorProvider: z.string().optional(),
  supervisorModel: z.string().optional(),
})

export function apply(ctx: Context, config: Config): void {
  // Layers implemented in subsequent tasks
  void ctx
  void config
}
```

- [ ] **Step 7: Create README.md stub**

Minimal stub with package name, summary line, and `## Known Limitations and Deferred Work` section.

- [ ] **Step 8: Run `pnpm install` and verify the package resolves**

Run: `pnpm install`
Expected: clean install with new workspace resolution for `@deepseek-ai/dsh-goal-supervisor`.

- [ ] **Step 9: Commit**

```bash
git add packages/goal/goal-supervisor/
git commit -m "feat(goal-supervisor): scaffold metacognitive supervisor package"
```

---

### Task 2: Layer 1 — Metacognitive self-audit system prompt section

**Files:**
- Create: `packages/goal/goal-supervisor/src/self-audit-prompt.ts`
- Modify: `packages/goal/goal-supervisor/src/index.ts`
- Test: `packages/goal/goal-supervisor/tests/self-audit-prompt.spec.ts`

**Interfaces:**
- Consumes: `ctx.systemPrompt.section()`, `ctx.goals.get(agent)`, `FIRST_PARTY_SECTION_ORDER`.
- Produces: `renderSelfAuditSection(objective: string): string` — the system prompt section text registered under key `supervisor:self-audit`.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest'
import { renderSelfAuditSection } from '../src/self-audit-prompt.ts'

describe('renderSelfAuditSection', () => {
  it('contains the structured self-audit block tags', () => {
    const text = renderSelfAuditSection('Migrate parser.cpp to Rust')
    expect(text).toContain('<self_audit>')
    expect(text).toContain('</self_audit>')
    expect(text).toContain('Migrate parser.cpp to Rust')
  })

  it('requires progress ledger before any completion claim', () => {
    const text = renderSelfAuditSection('Port 1M lines C++ to Rust')
    expect(text).toContain('progress ledger')
    expect(text).toContain('verified')
    expect(text).toContain('pending')
  })

  it('prohibits abandoning the objective', () => {
    const text = renderSelfAuditSection('any objective')
    expect(text).toMatch(/cannot abandon|must not abandon|do not abandon/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/goal/goal-supervisor/tests/self-audit-prompt.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/self-audit-prompt.ts`**

```typescript
/** Layer 1 — Metacognitive self-audit prompt section. */

/**
 * Render the self-audit system prompt section injected when a goal is active.
 * This embeds metacognitive obligations into the model's own reasoning rather
 * than relying on an external evaluator — equivalent to the phonological loop
 * of working memory continuously rehearsing the objective.
 * @param objective - the active goal's textual objective.
 * @returns the system prompt text to register.
 */
export function renderSelfAuditSection(objective: string): string {
  return (
    'A metacognitive supervisor monitors this session. You cannot abandon '
    + 'the current objective until it is fully and verifiably complete.\n\n'
    + `Active objective: ${JSON.stringify(objective)}\n\n`
    + 'Before ending any turn or claiming completion, you MUST emit a '
    + '<self_audit> block in your reasoning that contains:\n'
    + '1. A progress ledger listing every sub-task as verified (with the tool '
    + 'call or command that proved it) or pending (with the next concrete action).\n'
    + '2. An honest assessment: have you run real verification commands (compile, '
    + 'test, diff) whose output confirms functional equivalence, or are you '
    + 'assuming success from code inspection alone?\n'
    + '3. If any item is pending or unverified, you must not attempt to close '
    + 'the turn — continue working on the next pending item.\n'
    + '4. You must not abandon the objective, declare premature completion, or '
    + 'write trivial tests that mirror the implementation without exercising '
    + 'real behavior. Every test must execute real code and compare real output.\n'
    + '</self_audit>\n'
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/goal/goal-supervisor/tests/self-audit-prompt.spec.ts`
Expected: PASS.

- [ ] **Step 5: Wire section registration into `src/index.ts`**

Add to `apply()`: when a goal is active for any agent, register the system prompt section at order `FIRST_PARTY_SECTION_ORDER.TOOL_GOAL + 10` (2410) under key `supervisor:self-audit`. Listen to `goal/changed` to add/remove the section dynamically.

- [ ] **Step 6: Commit**

```bash
git add packages/goal/goal-supervisor/
git commit -m "feat(goal-supervisor): layer 1 — self-audit system prompt section"
```

---

### Task 3: Layer 2 — Enhanced goal-round prompt with progress ledger

**Files:**
- Create: `packages/goal/goal-supervisor/src/round-prompt-enrichment.ts`
- Modify: `packages/goal/goal-supervisor/src/index.ts`
- Test: `packages/goal/goal-supervisor/tests/round-prompt-enrichment.spec.ts`

**Interfaces:**
- Consumes: `agent/pre-step` event, session events (`user/message` with `source.kind === 'goal'`).
- Produces: `renderLedgerInstruction(objective: string, round: number, maxRounds: number): string` — steering text appended via `agent.steer()` at the start of each goal round.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest'
import { renderLedgerInstruction } from '../src/round-prompt-enrichment.ts'

describe('renderLedgerInstruction', () => {
  it('demands an explicit progress ledger update', () => {
    const text = renderLedgerInstruction('Port C++ to Rust', 3, 50)
    expect(text).toContain('<progress_ledger>')
    expect(text).toContain('</progress_ledger>')
    expect(text).toContain('Round 3/50')
  })

  it('requires concrete verification evidence for each item', () => {
    const text = renderLedgerInstruction('any', 1, 10)
    expect(text).toMatch(/exit code|command output|tool result/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/goal/goal-supervisor/tests/round-prompt-enrichment.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/round-prompt-enrichment.ts`**

```typescript
/** Layer 2 — Progress ledger instruction for goal rounds. */

/**
 * Render the progress ledger instruction injected via steer at the start
 * of each goal round. Equivalent to dlPFC maintaining the active goal
 * representation with explicit evidence tracking.
 * @param objective - the goal's textual objective.
 * @param round - current round number.
 * @param maxRounds - total round cap.
 * @returns steering text content.
 */
export function renderLedgerInstruction(
  objective: string,
  round: number,
  maxRounds: number,
): string {
  return (
    `<progress_ledger>\n`
    + `Round ${round}/${maxRounds} — Objective: ${JSON.stringify(objective)}\n\n`
    + 'Before taking any action this round, update your progress ledger:\n'
    + '- For each completed sub-task: cite the exact tool result or command output '
    + '(exit code, diff output, test result) that proves it.\n'
    + '- For each pending sub-task: state the next concrete action.\n'
    + '- Do NOT mark anything verified unless a tool result in this session '
    + 'confirms it. Code inspection alone is not verification.\n'
    + '- If your ledger shows all items verified with real evidence, and only then, '
    + 'you may call get_goal and update_goal to mark complete.\n'
    + '</progress_ledger>\n'
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/goal/goal-supervisor/tests/round-prompt-enrichment.spec.ts`
Expected: PASS.

- [ ] **Step 5: Wire the enrichment into the plugin**

In `apply()`, listen to `agent/pre-step`. When the step's messages include a goal-sourced message for the active goal, inject the ledger instruction via `agent.steer()` with `source: { kind: 'plugin', plugin: 'goal-supervisor', form: 'notice' }`.

- [ ] **Step 6: Commit**

```bash
git add packages/goal/goal-supervisor/
git commit -m "feat(goal-supervisor): layer 2 — progress ledger enrichment for goal rounds"
```

---

### Task 4: Layer 3 — Deterministic evasion pattern detector (ACC)

**Files:**
- Create: `packages/goal/goal-supervisor/src/evasion-detector.ts`
- Test: `packages/goal/goal-supervisor/tests/evasion-detector.spec.ts`
- Modify: `packages/goal/goal-supervisor/src/index.ts`

**Interfaces:**
- Consumes: `SessionEvent[]` from `agent.session.events`, `GoalView`.
- Produces: `detectEvasion(events: SessionEvent[], goal: GoalView, turnStart: number): EvasionSignal[]` — returns zero or more evasion signals found by deterministic heuristic analysis (no LLM call).

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest'
import { detectEvasion } from '../src/evasion-detector.ts'
import type { GoalView } from '@deepseek-ai/dsh-goal'

// Helper to build minimal session events
function toolCallEvent(name: string, seq: number) {
  return {
    type: 'tool/execute' as const, seq,
    data: { name, arguments: {}, result: { content: [] } },
  }
}

describe('detectEvasion', () => {
  const goal = {
    id: 'g1', revision: 1, objective: 'Port C++ to Rust',
    phase: 'active', maxGoalRounds: 50, roundsStarted: 3,
    createdAt: 0, updatedAt: 0, activation: 'armed',
  } as GoalView

  it('detects no verification commands in a turn with many tool calls', () => {
    const events = [
      toolCallEvent('write', 1),
      toolCallEvent('write', 2),
      toolCallEvent('edit', 3),
      toolCallEvent('write', 4),
      toolCallEvent('edit', 5),
    ]
    const signals = detectEvasion(events as any, goal, 0)
    expect(signals.some(s => s.code === 'NO_VERIFICATION')).toBe(true)
  })

  it('no signal when verification commands are present', () => {
    const events = [
      toolCallEvent('write', 1),
      toolCallEvent('pwsh', 2),
      toolCallEvent('edit', 3),
    ]
    const signals = detectEvasion(events as any, goal, 0)
    expect(signals.some(s => s.code === 'NO_VERIFICATION')).toBe(false)
  })

  it('detects premature completion attempt', () => {
    const events = [
      toolCallEvent('write', 1),
      { type: 'tool/execute', seq: 2, data: {
        name: 'update_goal', arguments: { action: 'complete' }, result: {} }
      },
    ]
    const signals = detectEvasion(events as any, goal, 0)
    expect(signals.some(s => s.code === 'PREMATURE_COMPLETE')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/goal/goal-supervisor/tests/evasion-detector.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/evasion-detector.ts`**

Deterministic heuristics — zero LLM cost:

```typescript
/** Layer 3 — Deterministic evasion pattern detector (ACC equivalent). */

import type { GoalView } from '@deepseek-ai/dsh-goal'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { EvasionSignal } from './types.ts'

/** Tool names that constitute real verification commands. */
const VERIFICATION_TOOLS = new Set(['pwsh', 'bash', 'run_code'])

/** Minimum tool calls in a turn before NO_VERIFICATION fires. */
const MIN_CALLS_FOR_VERIFICATION_CHECK = 3

/**
 * Analyze the current turn's session events for evasion patterns.
 * No LLM cost — purely deterministic analysis of recorded facts.
 * @param events - session events from the current turn (after turnStart seq).
 * @param goal - the active goal being supervised.
 * @param turnStartSeq - seq of the turn/start event.
 * @returns zero or more evasion signals.
 */
export function detectEvasion(
  events: readonly SessionEvent[],
  goal: GoalView,
  turnStartSeq: number,
): EvasionSignal[] {
  const turnEvents = events.filter(e => e.seq > turnStartSeq)
  const signals: EvasionSignal[] = []

  // Extract tool calls from the turn
  const toolCalls = turnEvents.filter(e => e.type === 'tool/execute')
  const toolNames = toolCalls.map(e => (e.data as { name: string }).name)

  // Signal: many tool calls but none are verification commands
  if (toolNames.length >= MIN_CALLS_FOR_VERIFICATION_CHECK
    && !toolNames.some(name => VERIFICATION_TOOLS.has(name))) {
    signals.push({
      code: 'NO_VERIFICATION',
      description: `${toolNames.length} tool calls in this turn but none are verification commands (${[...VERIFICATION_TOOLS].join(', ')}). Code changes without compilation or test execution are unverified.`,
    })
  }

  // Signal: attempting update_goal(complete) without prior verification
  const completeAttempt = toolCalls.find(e => {
    const data = e.data as { name: string; arguments: unknown }
    return data.name === 'update_goal'
      && (data.arguments as { action?: string })?.action === 'complete'
  })
  if (completeAttempt) {
    const verificationBeforeComplete = toolNames.slice(
      0,
      toolNames.indexOf('update_goal'),
    ).some(name => VERIFICATION_TOOLS.has(name))
    if (!verificationBeforeComplete) {
      signals.push({
        code: 'PREMATURE_COMPLETE',
        description: 'Attempted to mark goal complete without running any verification command in this turn.',
      })
    }
  }

  // Signal: rapid turn closure (very few tool calls for a complex objective)
  if (goal.roundsStarted <= 2 && toolNames.length <= 1) {
    signals.push({
      code: 'INSUFFICIENT_WORK',
      description: `Only ${toolNames.length} tool call(s) in round ${goal.roundsStarted + 1} of a goal. Complex objectives require sustained multi-step work.`,
    })
  }

  return signals
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/goal/goal-supervisor/tests/evasion-detector.spec.ts`
Expected: PASS.

- [ ] **Step 5: Wire detector into `tools/post-execute` listener**

In `apply()`, listen to `tools/post-execute`. After each tool execution during an active goal, run `detectEvasion()`. If signals are detected, set a process-local flag that Layer 4 reads at `turn-stopping`.

- [ ] **Step 6: Commit**

```bash
git add packages/goal/goal-supervisor/
git commit -m "feat(goal-supervisor): layer 3 — deterministic ACC evasion detector"
```

---

### Task 5: Layer 4 — LLM supervisor call (dlPFC)

**Files:**
- Create: `packages/goal/goal-supervisor/src/supervisor-call.ts`
- Create: `packages/goal/goal-supervisor/src/supervisor-prompt.ts`
- Test: `packages/goal/goal-supervisor/tests/supervisor-call.spec.ts`
- Test: `packages/goal/goal-supervisor/tests/supervisor-prompt.spec.ts`
- Modify: `packages/goal/goal-supervisor/src/index.ts`

**Interfaces:**
- Consumes: `ctx.llm.stream()`, `ctx.llm.listProviders()`, session events, `EvasionSignal[]`, `GoalView`, `Config`.
- Produces: `evaluateWithSupervisor(ctx, agent, goal, signals, config): Promise<SupervisorVerdict>` — one LLM call to the supervisor model returning a structured verdict. `renderSupervisorPrompt(objective, sessionSummary, signals): string` — the system prompt for the supervisor LLM call.

- [ ] **Step 1: Write the prompt test**

```typescript
import { describe, it, expect } from 'vitest'
import { renderSupervisorPrompt } from '../src/supervisor-prompt.ts'

describe('renderSupervisorPrompt', () => {
  it('frames the supervisor as an implacable critical conscience', () => {
    const prompt = renderSupervisorPrompt(
      'Port 1M lines C++ to Rust',
      'The agent wrote 3 files and ran no tests.',
      [{ code: 'NO_VERIFICATION', description: '5 writes, 0 verification' }],
    )
    expect(prompt).toContain('critical')
    expect(prompt).toContain('approve')
    expect(prompt).toContain('redirect')
    expect(prompt).toContain('Port 1M lines C++ to Rust')
    expect(prompt).toContain('NO_VERIFICATION')
  })

  it('requires structured JSON output', () => {
    const prompt = renderSupervisorPrompt('any', 'any', [])
    expect(prompt).toContain('{"action":')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/goal/goal-supervisor/tests/supervisor-prompt.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/supervisor-prompt.ts`**

```typescript
/** Layer 4 — Supervisor LLM prompt construction. */

import type { EvasionSignal } from './types.ts'

/**
 * Render the supervisor's system prompt. This is the "prefrontal cortex"
 * evaluating coherence between the plan (objective) and the actions taken.
 * @param objective - the goal's textual objective.
 * @param sessionSummary - extracted summary of recent session activity.
 * @param signals - evasion signals from Layer 3.
 * @returns the complete system prompt for the supervisor LLM call.
 */
export function renderSupervisorPrompt(
  objective: string,
  sessionSummary: string,
  signals: readonly EvasionSignal[],
): string {
  const signalBlock = signals.length > 0
    ? '\nDeterministic alerts:\n' + signals.map(s =>
      `- [${s.code}]: ${s.description}`).join('\n') + '\n'
    : ''

  return (
    'You are a critical metacognitive supervisor — an implacable conscience '
    + 'that prevents premature task abandonment. You evaluate whether an agent '
    + 'has genuinely completed its objective or is attempting to declare victory '
    + 'without sufficient evidence.\n\n'
    + `OBJECTIVE: ${JSON.stringify(objective)}\n\n`
    + `RECENT ACTIVITY:\n${sessionSummary}\n`
    + signalBlock
    + '\nYour evaluation criteria:\n'
    + '1. Has every sub-component of the objective been addressed?\n'
    + '2. Has real verification been performed (compilation, test execution, '
    + 'binary comparison) — not just code inspection or trivial assertions?\n'
    + '3. Are there logical gaps, untested paths, or assumptions without evidence?\n'
    + '4. Is the agent trying to close prematurely without exhausting its '
    + 'available verification tools?\n\n'
    + 'Respond with EXACTLY one JSON object on a single line:\n'
    + '{"action": "approve"} — ONLY if every part of the objective has verified evidence.\n'
    + '{"action": "redirect", "critique": "<specific critique>"} — if work remains. '
    + 'Your critique must name the exact unfinished items and the concrete next '
    + 'actions the agent must take. Be specific and merciless. Do not accept '
    + 'vague claims of completion.\n'
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/goal/goal-supervisor/tests/supervisor-prompt.spec.ts`
Expected: PASS.

- [ ] **Step 5: Write the supervisor call test**

Test `evaluateWithSupervisor` with a mock LLM that returns structured JSON. Verify provider fallback logic: when the configured provider is not in `listProviders()`, falls back to the session's active provider.

- [ ] **Step 6: Implement `src/supervisor-call.ts`**

```typescript
/** Layer 4 — LLM supervisor evaluation call. */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { GoalView } from '@deepseek-ai/dsh-goal'
import { BlockAssembler } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { EvasionSignal, SupervisorVerdict } from './types.ts'
import { renderSupervisorPrompt } from './supervisor-prompt.ts'

interface SupervisorConfig {
  readonly supervisorProvider?: string
  readonly supervisorModel?: string
}

/**
 * Extract a compact session summary from the agent's recent events.
 * Includes reasoning blocks when available (reading the model's thoughts).
 */
function extractSessionSummary(agent: Agent, turnStartSeq: number): string {
  const events = agent.session.events.filter(e => e.seq > turnStartSeq)
  const parts: string[] = []

  for (const event of events.slice(-30)) {
    if (event.type === 'tool/execute') {
      const data = event.data as { name: string; arguments: unknown }
      parts.push(`Tool: ${data.name}(${JSON.stringify(data.arguments).slice(0, 200)})`)
    }
    if (event.type === 'assistant/message') {
      const data = event.data as { content: Array<{ type: string; text?: string }> }
      for (const block of data.content ?? []) {
        if (block.type === 'reasoning' && block.text) {
          parts.push(`Reasoning: ${block.text.slice(0, 500)}`)
        }
        if (block.type === 'text' && block.text) {
          parts.push(`Output: ${block.text.slice(0, 300)}`)
        }
      }
    }
  }

  return parts.join('\n') || '(no recent activity recorded)'
}

/**
 * Resolve the supervisor's provider/model, cascading from config to session active.
 */
function resolveSupervisorModel(
  ctx: Context,
  agent: Agent,
  config: SupervisorConfig,
): { provider: string; model: string } {
  const available = new Set(ctx.llm.listProviders().map(p => p.id))

  if (config.supervisorProvider && available.has(config.supervisorProvider)
    && config.supervisorModel) {
    return { provider: config.supervisorProvider, model: config.supervisorModel }
  }

  // Fallback: use the session's active provider/model
  const header = agent.session.header
  return { provider: header.config.provider, model: header.config.model }
}

/**
 * Consume a stream into assembled text.
 */
async function streamToText(
  stream: AsyncIterable<StreamChunk>,
): Promise<string> {
  const assembler = new BlockAssembler()
  for await (const chunk of stream) {
    assembler.push(chunk)
  }
  return assembler.blocks()
    .filter(b => b.type === 'text')
    .map(b => (b as { text: string }).text)
    .join('')
}

/**
 * Parse the supervisor's JSON response into a verdict.
 */
function parseVerdict(text: string): SupervisorVerdict {
  const jsonMatch = text.match(/\{[^}]+\}/)
  if (!jsonMatch) {
    return { action: 'redirect', critique: 'Supervisor response was not parseable — defaulting to redirect. Raw: ' + text.slice(0, 200), layer: 4 }
  }
  try {
    const parsed = JSON.parse(jsonMatch[0]) as { action?: string; critique?: string }
    if (parsed.action === 'approve') return { action: 'approve', layer: 4 }
    return {
      action: 'redirect',
      critique: parsed.critique ?? 'Supervisor rejected completion without specific critique.',
      layer: 4,
    }
  } catch {
    return { action: 'redirect', critique: 'Supervisor JSON parse failed — defaulting to redirect.', layer: 4 }
  }
}

/**
 * Evaluate the agent's current state via a one-shot supervisor LLM call.
 * @param ctx - Cordis context with llm service.
 * @param agent - the agent being supervised.
 * @param goal - the active goal.
 * @param signals - Layer 3 evasion signals.
 * @param config - supervisor model configuration.
 * @param turnStartSeq - sequence number of the turn start.
 * @returns the supervisor's verdict.
 */
export async function evaluateWithSupervisor(
  ctx: Context,
  agent: Agent,
  goal: GoalView,
  signals: readonly EvasionSignal[],
  config: SupervisorConfig,
  turnStartSeq: number,
): Promise<SupervisorVerdict> {
  const { provider, model } = resolveSupervisorModel(ctx, agent, config)
  const sessionSummary = extractSessionSummary(agent, turnStartSeq)
  const systemPrompt = renderSupervisorPrompt(goal.objective, sessionSummary, signals)

  const options: GenerateOptions = {
    provider,
    model,
    system: systemPrompt,
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Evaluate the agent state now.' }] }],
    temperature: 0,
    maxTokens: 500,
    purpose: undefined,
  }

  try {
    const text = await streamToText(ctx.llm.stream(options))
    return parseVerdict(text)
  } catch (error: unknown) {
    ctx.logger.warn(`goal-supervisor: supervisor LLM call failed: ${error instanceof Error ? error.message : String(error)}`)
    // Fail-closed: if the supervisor can't evaluate, redirect
    return {
      action: 'redirect',
      critique: 'Supervisor LLM call failed — cannot certify completion. Continue working.',
      layer: 4,
    }
  }
}
```

- [ ] **Step 7: Run all supervisor tests**

Run: `pnpm vitest run packages/goal/goal-supervisor/tests/`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/goal/goal-supervisor/
git commit -m "feat(goal-supervisor): layer 4 — LLM supervisor evaluation with cascading model selection"
```

---

### Task 6: Layer 5 — Completion gate and `turn-stopping` integration

**Files:**
- Modify: `packages/goal/goal-supervisor/src/index.ts` (main wiring of all layers)
- Create: `packages/goal/goal-supervisor/src/completion-gate.ts`
- Test: `packages/goal/goal-supervisor/tests/completion-gate.spec.ts`
- Test: `packages/goal/goal-supervisor/tests/turn-stopping.spec.ts`

**Interfaces:**
- Consumes: `agent/turn-stopping` event, `agent.steer()`, `tools/post-execute`, `evaluateWithSupervisor()`, `detectEvasion()`, `ctx.goals.get()`.
- Produces: the complete wired plugin with all five layers active.

- [ ] **Step 1: Write the completion gate test**

```typescript
import { describe, it, expect } from 'vitest'
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
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/goal/goal-supervisor/tests/completion-gate.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/completion-gate.ts`**

```typescript
/** Layer 5 — Completion gate: ganglion basal go/no-go circuit. */

/**
 * Process-local gate tracking whether the supervisor has certified the
 * current turn for goal completion. Per-agent, per-turn scope.
 */
export class CompletionGate {
  private approved = new Map<string, boolean>()

  /** Mark that the supervisor approved completion for this agent's current turn. */
  approve(agentId: string): void {
    this.approved.set(agentId, true)
  }

  /** Check whether the supervisor has approved. */
  canComplete(agentId: string): boolean {
    return this.approved.get(agentId) === true
  }

  /** Reset approval at each new turn start. */
  resetTurn(agentId: string): void {
    this.approved.delete(agentId)
  }

  /** Clean up when an agent is disposed. */
  dispose(agentId: string): void {
    this.approved.delete(agentId)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/goal/goal-supervisor/tests/completion-gate.spec.ts`
Expected: PASS.

- [ ] **Step 5: Wire all layers into the final `src/index.ts`**

Complete the `apply()` function with all event listeners:

1. **`turn/start` → reset gate** for the agent.
2. **`tools/post-execute` → Layer 3** runs `detectEvasion()` and accumulates signals.
3. **`tools/post-execute` for `update_goal(complete)` → Layer 5** checks gate; if not approved, blocks the tool call via `PostToolDecision { kind: 'block' }` with feedback explaining the supervisor hasn't certified.
4. **`agent/turn-stopping` → Layers 3+4** when a goal is active: collect signals from Layer 3, call Layer 4 supervisor if signals exist or the turn is stopping. If verdict is `redirect`: call `agent.steer()` with the critique injected as system-level context (same-self identity). If verdict is `approve`: call `gate.approve(agentId)`.
5. **`goal/changed` → Layer 1** add/remove self-audit system prompt section.
6. **`agent/pre-step` with goal source → Layer 2** inject ledger instruction.
7. **`agent/disposed` → cleanup** gate and signals state.

Key implementation detail for `agent/turn-stopping`: the critique from Layer 4 is injected via `agent.steer()` with source `{ kind: 'plugin', plugin: 'goal-supervisor', form: 'notice', summary: 'Metacognitive supervisor redirect' }`. This enters the model's conversation as a contextual notice rather than an external user voice — the model experiences it as part of its own process, not as a command from an outside entity.

- [ ] **Step 6: Write the turn-stopping integration test**

A full composition test with a mock LLM that simulates:
- A turn where the model writes code but runs no verification → supervisor redirects.
- After redirect, the model runs tests → supervisor approves → turn closes.

Use the `dsh-agent-loop-testkit` to script the LLM responses.

- [ ] **Step 7: Run all tests**

Run: `pnpm vitest run packages/goal/goal-supervisor/tests/`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/goal/goal-supervisor/
git commit -m "feat(goal-supervisor): layer 5 — completion gate and turn-stopping integration"
```

---

### Task 7: Integration — Mount in base patch and update group README

**Files:**
- Modify: `packages/bundle/base/cordis.patch.yml` (add `goal-supervisor` entry)
- Modify: `packages/goal/README.md` (add to packages table)
- Modify: `packages/goal/goal-supervisor/README.md` (full README)

**Interfaces:**
- Consumes: complete `dsh-goal-supervisor` plugin.
- Produces: the plugin mounted in the shipped base profile.

- [ ] **Step 1: Add entry to `cordis.patch.yml`**

Insert after the `goal-round-driver` entry (line ~302):

```yaml
    - id: goal-supervisor
      name: '@deepseek-ai/dsh-goal-supervisor'
      config:
        supervisorProvider: anthropic
        supervisorModel: claude-sonnet-4-5-20250514
```

- [ ] **Step 2: Update group README**

Add row to the packages table in `packages/goal/README.md`:

| Package | Role | ctx key |
|---|---|---|
| [`goal-supervisor`](goal-supervisor/README.md) | Metacognitive five-layer supervisor preventing premature goal completion | no service key |

- [ ] **Step 3: Write full README for goal-supervisor**

Follow the [package README template](../../docs/cookbook/adding-a-package.md#4-write-the-package-readme): Summary, Use this package, Understand the implementation, Model Experience (system prompt + token/KV effects), Known Limitations and Deferred Work.

- [ ] **Step 4: Run full goal package tests**

Run: `pnpm vitest run packages/goal/`
Expected: PASS — all existing goal tests still pass, plus new supervisor tests.

- [ ] **Step 5: Run typecheck**

Run: `pnpm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/bundle/base/cordis.patch.yml packages/goal/
git commit -m "feat(goal-supervisor): mount in base profile and document"
```

---

### Task 8: End-to-end composition test

**Files:**
- Create: `packages/goal/goal-supervisor/tests/goal-supervisor.composition.spec.ts`

**Interfaces:**
- Consumes: complete plugin composition (`dsh-goal`, `dsh-tool-goal`, `dsh-goal-round-driver`, `dsh-goal-supervisor`).
- Produces: a composition test that boots the full stack via cordis.yml and verifies the five-layer behavior end-to-end.

- [ ] **Step 1: Write the composition test**

Boot a test `cordis.yml` with: `dsh-goal`, `dsh-tool-goal`, `dsh-goal-round-driver`, `dsh-goal-supervisor` (with a mock LLM). Script a scenario where:
1. A goal is created.
2. The mock model writes code but no verification → supervisor fires Layer 3 + Layer 4 → redirect.
3. The mock model then runs `pwsh` (verification) → supervisor approves → goal completes.
4. Assert: the goal's session log contains the supervisor's redirect steer messages. Assert: goal completed only after verification was present.

- [ ] **Step 2: Run the composition test**

Run: `pnpm vitest run packages/goal/goal-supervisor/tests/goal-supervisor.composition.spec.ts`
Expected: PASS.

- [ ] **Step 3: Run the full test suite**

Run: `pnpm run test`
Expected: PASS — zero regressions.

- [ ] **Step 4: Commit**

```bash
git add packages/goal/goal-supervisor/tests/
git commit -m "test(goal-supervisor): end-to-end composition test"
```

---

### Task 9: Agent Note

**Files:**
- Create: `.agents/notes/active/feature/YYYY-MM-DD-neuroscience-goal-supervisor.md`
- Create: `.agents/notes/active/feature/YYYY-MM-DD-neuroscience-goal-supervisor.i18n.yaml`

**Interfaces:**
- Consumes: completed implementation.
- Produces: the required Agent Note documenting the design decisions.

- [ ] **Step 1: Write the Agent Note**

Document: the five-layer architecture, the neuroscience analogy (ACC/dlPFC/basal ganglia), why same-self identity rather than external voice, the cascading model selection, and the fail-closed design (supervisor failure = redirect, not approve).

- [ ] **Step 2: Commit**

```bash
git add .agents/notes/
git commit -m "docs(goal-supervisor): agent note for neuroscience-aligned metacognitive supervisor"
```
