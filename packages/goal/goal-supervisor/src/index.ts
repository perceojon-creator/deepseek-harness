/**
 * Neuroscience-aligned metacognitive goal supervisor.
 * @module @deepseek-ai/dsh-goal-supervisor
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { FIRST_PARTY_SECTION_ORDER } from '@deepseek-ai/dsh-system-prompt'
import { renderSelfAuditSection } from './self-audit-prompt.ts'

export { renderSelfAuditSection } from './self-audit-prompt.ts'

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
}
