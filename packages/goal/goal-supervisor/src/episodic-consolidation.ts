/** Layer 4.5 — Episodic consolidation (hippocampal replay). */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { GoalView } from '@deepseek-ai/dsh-goal'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import { extractSessionSummary, resolveSupervisorModel, streamToText } from './supervisor-call.ts'
import type { SupervisorConfig } from './supervisor-call.ts'

/**
 * Render the consolidation prompt for the supervisor LLM.
 * @param objective - The goal's textual objective.
 * @param sessionSummary - Extracted summary of all session activity.
 * @returns The system prompt for the consolidation LLM call.
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
 * @param text - The raw LLM response.
 * @returns The consolidation content, or the full text if no block tags found.
 */
export function parseConsolidation(text: string): string {
  const match = text.match(/<episodic_consolidation>[\s\S]*?<\/episodic_consolidation>/)
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
   * @param roundsStarted - How many goal rounds have been completed.
   * @param interval - Consolidation interval in rounds.
   * @returns True if consolidation should fire.
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
   * @param agent - The agent whose session is being consolidated.
   * @param goal - The active goal.
   * @param config - Supervisor model configuration.
   * @returns The consolidation summary text.
   */
  async consolidate(
    ctx: Context,
    agent: Agent,
    goal: GoalView,
    config: SupervisorConfig,
  ): Promise<string> {
    const { provider, model } = resolveSupervisorModel(ctx, agent, config)
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
   * @returns The current summary, or undefined if no consolidation has occurred.
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
