/** Layer 3 — Deterministic evasion pattern detector (ACC equivalent). */

import type { GoalView } from '@deepseek-ai/dsh-goal'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { EvasionSignal } from './types.ts'

export const VERIFICATION_TOOLS = new Set(['pwsh', 'bash', 'run_code'])
export const MIN_CALLS_FOR_VERIFICATION_CHECK = 3

/**
 * Analyze the current turn's session events for evasion patterns.
 * No LLM cost — purely deterministic analysis of recorded facts.
 * @param events - session events from the current turn (after turnStart seq).
 * @param goal - the active goal being supervised.
 * @param turnStartSeq - sequence number of the turn/start event.
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
  const completeAttemptIndex = toolCalls.findIndex((e) => {
    const data = e.data as { name: string; arguments: unknown }
    return data.name === 'update_goal'
      && (data.arguments as { action?: string })?.action === 'complete'
  })
  if (completeAttemptIndex !== -1) {
    const verificationBeforeComplete = toolNames.slice(0, completeAttemptIndex).some(name => VERIFICATION_TOOLS.has(name))
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
