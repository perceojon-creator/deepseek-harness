/**
 * Neuroscience-aligned metacognitive goal supervisor.
 * @module @deepseek-ai/dsh-goal-supervisor
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { FIRST_PARTY_SECTION_ORDER } from '@deepseek-ai/dsh-system-prompt'
import { renderSelfAuditSection } from './self-audit-prompt.ts'
import { renderLedgerInstruction } from './round-prompt-enrichment.ts'

export { renderSelfAuditSection } from './self-audit-prompt.ts'
export { renderLedgerInstruction } from './round-prompt-enrichment.ts'
export { detectEvasion } from './evasion-detector.ts'

export const name = 'goal-supervisor'
export const inject = ['agents', 'goals', 'llm', 'systemPrompt', 'tools']

export interface Config {
  supervisorProvider?: string
  supervisorModel?: string
}

export const Config: z<Config> = z.object({
  supervisorProvider: z.string(),
  supervisorModel: z.string(),
})

export function apply(ctx: Context, config: Config): void {
  void config

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

  // Layer 2: Progress ledger enrichment when a goal round is admitted
  ctx.on('agent/pre-step', ({ agent, messages }, next) => {
    const goalMessage = messages.find(m => m.source.kind === 'goal')
    if (goalMessage && goalMessage.source.kind === 'goal') {
      const goal = ctx.goals.get(agent)
      if (goal !== undefined && goal.phase === 'active') {
        const text = renderLedgerInstruction(goal.objective, goalMessage.source.round, goal.maxGoalRounds)
        agent.inbox.prepend('next-step', createUserMessage({
          content: [{ type: 'text', text }],
          source: { kind: 'plugin', plugin: 'goal-supervisor', form: 'notice', summary: 'Progress ledger requirement' },
        }))
      }
    }
    return next()
  })
}
