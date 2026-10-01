/**
 * Metacognitive goal supervisor: prompt sections, deterministic evidence
 * checks, an auxiliary evaluator model, and a completion gate for active goals.
 * @module @deepseek-ai/dsh-goal-supervisor
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { GoalId } from '@deepseek-ai/dsh-goal'
import type { GoalView } from '@deepseek-ai/dsh-goal'
import type { GoalId as GoalIdentifier } from '@deepseek-ai/dsh-goal/types'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { FIRST_PARTY_SECTION_ORDER } from '@deepseek-ai/dsh-system-prompt'
import type { PreToolDecision } from '@deepseek-ai/dsh-tools'
import { renderSelfAuditSection } from './self-audit-prompt.ts'
import { renderLedgerInstruction } from './round-prompt-enrichment.ts'
import { detectEvasion, hasSuccessfulVerification } from './evasion-detector.ts'
import { recordedCalls } from './recorded-activity.ts'
import { evaluateWithSupervisor } from './supervisor-call.ts'
import { PerseverationTracker } from './perseveration-detector.ts'
import { IntentionTracker } from './intention-tracker.ts'
import { analyzeReasoningQuality } from './forward-model-analyzer.ts'
import type { EvasionSignal, SalienceEntry } from './types.ts'
import { ConsolidationManager, renderEpisodicMemory } from './episodic-consolidation.ts'

export { renderSelfAuditSection } from './self-audit-prompt.ts'
export { renderLedgerInstruction } from './round-prompt-enrichment.ts'
export { detectEvasion } from './evasion-detector.ts'
export { renderSupervisorPrompt } from './supervisor-prompt.ts'
export { evaluateWithSupervisor } from './supervisor-call.ts'
export { PerseverationTracker, computeErrorSignature } from './perseveration-detector.ts'
export { IntentionTracker, extractPlannedTools } from './intention-tracker.ts'
export { analyzeReasoningQuality } from './forward-model-analyzer.ts'
export { ConsolidationManager, parseConsolidation, renderConsolidationPrompt, renderEpisodicMemory } from './episodic-consolidation.ts'

export const name = 'goal-supervisor'
export const inject = ['agents', 'goals', 'llm', 'systemPrompt', 'tools']

/** Configuration options for the metacognitive goal supervisor. */
export interface Config {
  /** Optional provider override for the supervisory LLM. */
  supervisorProvider?: string
  /** Optional model override for the supervisory LLM. */
  supervisorModel?: string
  /** Number of goal rounds between episodic consolidation summaries. */
  consolidationInterval: number
  /** Maximum characters of session activity sent to each supervisor request. */
  sessionSummaryMaxChars: number
  /** Milliseconds one supervisor or consolidation model request may run before it is aborted. */
  supervisorTimeoutMs: number
  /** Maximum supervisor steers in one turn of one goal revision before the turn is allowed to end. */
  maxConsecutiveRedirects: number
  /** Tool names whose calls count as code changes that require verification before the turn ends. */
  codeChangeTools: string[]
}

/** Schemastery schema for goal-supervisor configuration. */
export const Config: z<Config> = z.object({
  supervisorProvider: z.string().description('Optional provider override for the supervisory LLM.'),
  supervisorModel: z.string().description('Optional model override for the supervisory LLM.'),
  consolidationInterval: z.natural().min(1).default(5)
    .description('Number of goal rounds between episodic consolidation summaries.'),
  sessionSummaryMaxChars: z.natural().min(1_000).max(100_000).default(12_000)
    .description('Maximum characters of session activity sent to each supervisor request.'),
  supervisorTimeoutMs: z.natural().min(1_000).default(60_000)
    .description('Milliseconds one supervisor or consolidation model request may run before it is aborted.'),
  maxConsecutiveRedirects: z.natural().min(1).default(3)
    .description('Maximum supervisor steers in one turn of one goal revision before the turn is allowed to end.'),
  codeChangeTools: z.array(z.string()).default(['write', 'edit', 'str_replace_editor'])
    .description('Tool names whose calls count as code changes that require verification before the turn ends.'),
})

interface GoalSalience {
  readonly goalId: GoalIdentifier
  readonly revision: number
  readonly entries: readonly SalienceEntry[]
}

interface GoalConsolidationState {
  readonly goalId: GoalIdentifier
  readonly revision: number
  readonly manager: ConsolidationManager
}

interface RedirectBudget {
  readonly goalId: GoalIdentifier
  readonly revision: number
  readonly turn: number
  steers: number
}

/**
 * Read a completion request from parsed `update_goal` arguments. A completion
 * request without a string `goal_id` and a safe-integer `revision` matches no goal.
 */
function completionRequest(value: unknown): { readonly goalId: string; readonly revision: number } | undefined {
  if (typeof value !== 'object' || value === null || !('action' in value) || value.action !== 'complete') return undefined
  const goalId = 'goal_id' in value && typeof value.goal_id === 'string' ? value.goal_id : ''
  const revision = 'revision' in value && Number.isSafeInteger(value.revision) ? value.revision as number : -1
  return { goalId, revision }
}

function turnStartSequence(events: readonly SessionEvent[]): number {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]
    if (event?.type === 'turn/start') return event.seq
  }
  return 0
}

function activeGoal(ctx: Context, agent: Agent): GoalView | undefined {
  const goal = ctx.goals.get(agent)
  return goal?.phase === 'active' ? goal : undefined
}

export function apply(ctx: Context, config: Config): void {
  const perseverationTrackers = new Map<string, PerseverationTracker>()
  const intentionTracker = new IntentionTracker()
  const latestSalience = new Map<string, GoalSalience>()
  const consolidationManagers = new Map<string, GoalConsolidationState>()
  const redirectBudgets = new Map<string, RedirectBudget>()
  const codeChangeTools: ReadonlySet<string> = new Set(config.codeChangeTools)

  /** True when the last recorded code change has no successful verification after it. */
  function hasUnverifiedCodeChange(events: readonly SessionEvent[]): boolean {
    const lastChange = recordedCalls(events).findLast(call => codeChangeTools.has(call.name))
    return lastChange !== undefined && !hasSuccessfulVerification(events.filter(event => event.seq > lastChange.seq))
  }

  function turnSignals(events: readonly SessionEvent[], goal: GoalView, startSeq: number): EvasionSignal[] {
    const signals = detectEvasion(events, goal, startSeq)
    const driftSignal = intentionTracker.detectDrift(events, startSeq)
    if (driftSignal) signals.push(driftSignal)
    const weakReasoningSignal = analyzeReasoningQuality(events, startSeq)
    if (weakReasoningSignal) signals.push(weakReasoningSignal)
    return signals
  }

  // Layer 1: self-audit section for the agent whose prompt is being assembled.
  ctx.systemPrompt.section({
    name: 'supervisor:self-audit',
    order: FIRST_PARTY_SECTION_ORDER.TOOL_GOAL + 10,
    text: ({ agent }) => {
      const goal = agent === undefined ? undefined : activeGoal(ctx, agent)
      return goal === undefined ? '' : renderSelfAuditSection(goal.objective)
    },
  })

  // Layer 4.5: consolidated episodic summary for the assembling agent's goal revision.
  ctx.systemPrompt.section({
    name: 'supervisor:episodic-memory',
    order: FIRST_PARTY_SECTION_ORDER.TOOL_GOAL + 15,
    text: ({ agent }) => {
      const goal = agent === undefined ? undefined : activeGoal(ctx, agent)
      const state = agent === undefined ? undefined : consolidationManagers.get(agent.id)
      const summary = goal !== undefined && state?.goalId === goal.id && state.revision === goal.revision
        ? state.manager.getSummary()
        : undefined
      return summary === undefined ? '' : renderEpisodicMemory(summary)
    },
  })

  // Layer 2: Progress ledger enrichment when a goal round is admitted
  ctx.on('agent/pre-step', async ({ agent, messages }, next): Promise<PreStepDecision> => {
    const decision = await next()
    const source = messages.find(m => m.source.kind === 'goal')?.source
    const goal = activeGoal(ctx, agent)
    if (decision.kind === 'reject' || source?.kind !== 'goal' || goal === undefined) return decision
    const previousSalience = latestSalience.get(agent.id)
    const salience = previousSalience?.goalId === goal.id && previousSalience.revision === goal.revision
      ? previousSalience.entries
      : undefined
    if (salience === undefined) latestSalience.delete(agent.id)
    const text = renderLedgerInstruction(goal.objective, source.round, goal.maxGoalRounds, salience)
    const ledgerMsg = createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: 'plugin', plugin: 'goal-supervisor', form: 'notice', summary: 'Progress ledger requirement' },
    })
    return { ...decision, messages: [ledgerMsg, ...decision.messages] }
  })

  // Layer 5 (Gate): Deny unapproved completion before the tool body runs.
  ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
    if (!exec.agent || exec.name !== 'update_goal') return next()
    const request = completionRequest(exec.arguments)
    if (request === undefined) return next()
    const goal = activeGoal(ctx, exec.agent)
    const events = exec.agent.session.events
    if (goal === undefined || goal.id !== GoalId(request.goalId) || goal.revision !== request.revision) {
      return {
        kind: 'deny',
        reason: 'Goal completion blocked: the request does not match the active goal and revision.',
      }
    }

    const startSeq = turnStartSequence(events)
    if (hasUnverifiedCodeChange(events)) {
      return {
        kind: 'deny',
        reason: 'Goal completion blocked: the last code change has no successful recorded recognized verification result after it. In PTC mode, complete the run_code call that performed verification before attempting completion.',
      }
    }
    const verdict = await evaluateWithSupervisor(
      ctx, exec.agent, goal, turnSignals(events, goal, startSeq), config, startSeq, exec.signal,
    )
    if (verdict.action === 'redirect') {
      return {
        kind: 'deny',
        reason: verdict.critique,
      }
    }
    if (verdict.action === 'abstain') {
      if (exec.signal.aborted) return { kind: 'deny', reason: 'Goal completion cancelled.' }
      // Fail open: every recorded code change is already verified.
      ctx.logger.warn(`goal-supervisor: evaluator abstained (${verdict.reason}); allowing verified completion of goal ${goal.id} revision ${goal.revision}`)
    }
    latestSalience.delete(exec.agent.id)
    return next()
  })

  // Layers 3, 4 & 5: Turn-stopping interception and metacognitive steering
  ctx.on('agent/turn-stopping', async ({ agent, turn, signal }) => {
    const goal = activeGoal(ctx, agent)
    if (goal === undefined) {
      redirectBudgets.delete(agent.id)
      return
    }

    const events = agent.session.events
    const turnStartSeq = turnStartSequence(events)
    const turnEvents = events.filter(event => event.seq > turnStartSeq)

    let tracker = perseverationTrackers.get(agent.id)
    if (!tracker) {
      tracker = new PerseverationTracker()
      perseverationTrackers.set(agent.id, tracker)
    }
    tracker.recordTurn(events, turnStartSeq, turn)

    // Layer 4.5: episodic consolidation when the round interval is reached
    let consolidationState = consolidationManagers.get(agent.id)
    if (consolidationState?.goalId !== goal.id || consolidationState.revision !== goal.revision) {
      consolidationState = { goalId: goal.id, revision: goal.revision, manager: new ConsolidationManager() }
      consolidationManagers.set(agent.id, consolidationState)
    }
    if (consolidationState.manager.shouldConsolidate(goal.roundsStarted, config.consolidationInterval)) {
      await consolidationState.manager.consolidate(ctx, agent, goal, config, signal)
    }

    let budget = redirectBudgets.get(agent.id)
    if (budget?.goalId !== goal.id || budget.revision !== goal.revision || budget.turn !== turn) {
      budget = { goalId: goal.id, revision: goal.revision, turn, steers: 0 }
      redirectBudgets.set(agent.id, budget)
    }
    if (budget.steers >= config.maxConsecutiveRedirects) {
      ctx.logger.warn(`goal-supervisor: redirect budget of ${config.maxConsecutiveRedirects} exhausted for goal ${goal.id} revision ${goal.revision} in turn ${turn}; letting the turn end`)
      return
    }

    const signals = turnSignals(events, goal, turnStartSeq)
    const perseverationSignal = tracker.detect()
    if (perseverationSignal) signals.push(perseverationSignal)

    const verdict = await evaluateWithSupervisor(ctx, agent, goal, signals, config, turnStartSeq, signal)
    if (verdict.action === 'redirect' && verdict.salience !== undefined) {
      latestSalience.set(agent.id, { goalId: goal.id, revision: goal.revision, entries: verdict.salience })
    }
    if (verdict.action === 'approve') latestSalience.delete(agent.id)
    if (signal.aborted) return

    // Missing verification steers only a turn whose code changes remain unverified.
    let critique: string | undefined
    if (verdict.action === 'redirect') {
      critique = verdict.critique
    } else if (hasUnverifiedCodeChange(turnEvents)) {
      critique = 'This turn changed code without a successful recorded verification command after the last change. Run the verification before ending the turn.'
    }
    if (critique === undefined) return

    budget.steers++
    agent.steer(createUserMessage({
      content: [{ type: 'text', text: `[Metacognitive Supervisor]: ${critique}` }],
      source: {
        kind: 'plugin',
        plugin: 'goal-supervisor',
        form: 'notice',
        summary: 'Metacognitive supervisor redirect',
      },
    }))
  })

  // Clean up agent state when agent is disposed
  ctx.on('agent/disposed', ({ agent }) => {
    perseverationTrackers.delete(agent.id)
    latestSalience.delete(agent.id)
    consolidationManagers.delete(agent.id)
    redirectBudgets.delete(agent.id)
  })
}
