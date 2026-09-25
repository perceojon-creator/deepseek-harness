/**
 * Neuroscience-aligned metacognitive goal supervisor.
 * @module @deepseek-ai/dsh-goal-supervisor
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { FIRST_PARTY_SECTION_ORDER } from '@deepseek-ai/dsh-system-prompt'
import type { PostToolDecision } from '@deepseek-ai/dsh-tools'
import { renderSelfAuditSection } from './self-audit-prompt.ts'
import { renderLedgerInstruction } from './round-prompt-enrichment.ts'
import { detectEvasion } from './evasion-detector.ts'
import { evaluateWithSupervisor } from './supervisor-call.ts'
import { CompletionGate } from './completion-gate.ts'
import { PerseverationTracker } from './perseveration-detector.ts'
import { IntentionTracker } from './intention-tracker.ts'
import { analyzeReasoningQuality } from './forward-model-analyzer.ts'

export { renderSelfAuditSection } from './self-audit-prompt.ts'
export { renderLedgerInstruction } from './round-prompt-enrichment.ts'
export { detectEvasion } from './evasion-detector.ts'
export { renderSupervisorPrompt } from './supervisor-prompt.ts'
export { evaluateWithSupervisor } from './supervisor-call.ts'
export { CompletionGate } from './completion-gate.ts'
export { PerseverationTracker, computeErrorSignature } from './perseveration-detector.ts'
export { IntentionTracker, extractPlannedTools } from './intention-tracker.ts'
export { analyzeReasoningQuality } from './forward-model-analyzer.ts'
export { ConsolidationManager, parseConsolidation, renderConsolidationPrompt } from './episodic-consolidation.ts'

export const name = 'goal-supervisor'
export const inject = ['agents', 'goals', 'llm', 'systemPrompt', 'tools']

/** Configuration options for the metacognitive goal supervisor. */
export interface Config {
  /** Optional provider override for the supervisory LLM. */
  supervisorProvider?: string
  /** Optional model override for the supervisory LLM. */
  supervisorModel?: string
  /** Number of goal rounds between episodic consolidation summaries (default: 5). */
  consolidationInterval?: number
}

/** Schemastery schema for goal-supervisor configuration. */
export const Config: z<Config> = z.object({
  supervisorProvider: z.string().description('Optional provider override for the supervisory LLM.'),
  supervisorModel: z.string().description('Optional model override for the supervisory LLM.'),
  consolidationInterval: z.natural().min(1).default(5)
    .description('Number of goal rounds between episodic consolidation summaries.'),
})

export function apply(ctx: Context, config: Config): void {
  const gate = new CompletionGate()
  const perseverationTrackers = new Map<string, PerseverationTracker>()
  const intentionTracker = new IntentionTracker()
  const latestSalience = new Map<string, readonly import('./types.ts').SalienceEntry[]>()
  const consolidationManagers = new Map<string, import('./episodic-consolidation.ts').ConsolidationManager>()

  // Layer 1: Metacognitive self-audit system prompt section
  ctx.systemPrompt.section({
    name: 'supervisor:self-audit',
    order: FIRST_PARTY_SECTION_ORDER.TOOL_GOAL + 10,
    text: () => {
      const roots = ctx.agents.roots()
      for (const agent of roots) {
        const goal = ctx.goals.get(agent)
        if (goal !== undefined && goal.phase === 'active') {
          return renderSelfAuditSection(goal.objective)
        }
      }
      return ''
    },
  })

  // Layer 4.5: Episodic memory consolidation section
  ctx.systemPrompt.section({
    name: 'supervisor:episodic-memory',
    order: FIRST_PARTY_SECTION_ORDER.TOOL_GOAL + 15,
    text: () => {
      const roots = ctx.agents.roots()
      for (const agent of roots) {
        const goal = ctx.goals.get(agent)
        if (goal !== undefined && goal.phase === 'active') {
          const mgr = consolidationManagers.get(agent.id)
          return mgr?.getSummary() ?? ''
        }
      }
      return ''
    },
  })

  // Layer 2: Progress ledger enrichment when a goal round is admitted
  ctx.on('agent/pre-step', async ({ agent, messages }, next): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject') return decision
    const goalMessage = messages.find(m => m.source.kind === 'goal')
    if (goalMessage && 'round' in goalMessage.source) {
      const goal = ctx.goals.get(agent)
      if (goal !== undefined && goal.phase === 'active') {
        const salience = latestSalience.get(agent.id)
        const text = renderLedgerInstruction(goal.objective, goalMessage.source.round, goal.maxGoalRounds, salience)
        const ledgerMsg = createUserMessage({
          content: [{ type: 'text', text }],
          source: { kind: 'plugin', plugin: 'goal-supervisor', form: 'notice', summary: 'Progress ledger requirement' },
        })
        return {
          ...decision,
          messages: [ledgerMsg, ...decision.messages],
        }
      }
    }
    return decision
  })

  // Layer 5 (Gate): Intercept update_goal(complete) tool execution
  ctx.on('tools/post-execute', async (exec, _result, next): Promise<PostToolDecision> => {
    if (exec.agent && exec.name === 'update_goal') {
      try {
        const raw: unknown = typeof exec.arguments === 'string' ? JSON.parse(exec.arguments) : exec.arguments
        if (typeof raw === 'object' && raw !== null && 'action' in raw && (raw as Record<string, unknown>).action === 'complete') {
          if (!gate.canComplete(exec.agent.id)) {
            return {
              kind: 'block',
              feedback: [{
                type: 'text',
                text: 'Goal completion blocked: the metacognitive supervisor has not certified completion. You cannot mark complete until the supervisor verifies that the objective is achieved with real evidence.',
              }],
            }
          }
        }
      } catch {
        // If arguments parsing fails, delegate to normal error handling
      }
    }
    return next()
  })

  // Layers 3, 4 & 5: Turn-stopping interception and metacognitive steering
  ctx.on('agent/turn-stopping', async ({ agent }) => {
    // Reset per-turn approval so each turn requires fresh supervisor certification
    gate.resetTurn(agent.id)

    const goal = ctx.goals.get(agent)
    if (goal === undefined || goal.phase !== 'active') return

    // Find the sequence number of the current turn's start event
    const events = agent.session.events
    let turnStartSeq = 0
    for (let index = events.length - 1; index >= 0; index--) {
      const event = events[index]
      if (event?.type === 'turn/start') {
        turnStartSeq = event.seq
        break
      }
    }

    // Run Layer 3 deterministic evasion analysis
    const signals = detectEvasion(events, goal, turnStartSeq)

    // Check for perseveration (OFC repeated failure inhibition)
    let tracker = perseverationTrackers.get(agent.id)
    if (!tracker) {
      tracker = new PerseverationTracker()
      perseverationTrackers.set(agent.id, tracker)
    }
    tracker.recordTurn(events, turnStartSeq)
    const perseverationSignal = tracker.detect()
    if (perseverationSignal) {
      signals.push(perseverationSignal)
    }

    // Check for intention drift (VTA dopaminergic delta)
    const driftSignal = intentionTracker.detectDrift(events, turnStartSeq)
    if (driftSignal) {
      signals.push(driftSignal)
    }

    // Check for weak reasoning (cerebellar forward-model predictive check)
    const weakReasoningSignal = analyzeReasoningQuality(events, turnStartSeq)
    if (weakReasoningSignal) {
      signals.push(weakReasoningSignal)
    }

    // Run Layer 4 supervisor LLM evaluation
    const verdict = await evaluateWithSupervisor(
      ctx,
      agent,
      goal,
      signals,
      config,
      turnStartSeq,
    )

    if (verdict.salience && verdict.salience.length > 0) {
      latestSalience.set(agent.id, verdict.salience)
    }

    // Run Layer 4.5 episodic consolidation if interval reached
    let consolidationMgr = consolidationManagers.get(agent.id)
    if (!consolidationMgr) {
      const { ConsolidationManager } = await import('./episodic-consolidation.ts')
      consolidationMgr = new ConsolidationManager()
      consolidationManagers.set(agent.id, consolidationMgr)
    }
    if (consolidationMgr.shouldConsolidate(goal.roundsStarted, config.consolidationInterval ?? 5)) {
      await consolidationMgr.consolidate(ctx, agent, goal, config)
    }

    if (verdict.action === 'redirect') {
      const critiqueText = verdict.critique ?? 'Supervisor redirected: ensure the task is fully completed and verified.'
      agent.steer(createUserMessage({
        content: [{ type: 'text', text: `[Metacognitive Supervisor]: ${critiqueText}` }],
        source: {
          kind: 'plugin',
          plugin: 'goal-supervisor',
          form: 'notice',
          summary: 'Metacognitive supervisor redirect',
        },
      }))
    } else {
      gate.approve(agent.id)
    }
  })

  // Clean up agent state when agent is disposed
  ctx.on('agent/disposed', ({ agent }) => {
    gate.dispose(agent.id)
    perseverationTrackers.delete(agent.id)
    latestSalience.delete(agent.id)
    consolidationManagers.delete(agent.id)
  })
}
