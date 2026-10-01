/** Layer 3 — deterministic checks over recorded tool calls and results for unverified or premature completion. */

import type { GoalView } from '@deepseek-ai/dsh-goal'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { EvasionSignal } from './types.ts'
import { outcomeOf, parsedArguments, recordedCalls } from './recorded-activity.ts'
import type { RecordedCall } from './recorded-activity.ts'

/** Tool names recognized as empirical verification commands. */
export const VERIFICATION_TOOLS: ReadonlySet<string> = new Set(['pwsh', 'bash'])

/** Minimum tool calls before triggering unverified-action detection. */
export const MIN_CALLS_FOR_VERIFICATION_CHECK = 3

const VERIFICATION_COMMANDS: readonly RegExp[] = [
  /(?:^|[;&|]\s*)(?:pnpm|npm|yarn|bun)\s+(?:(?:run|exec)\s+)?(?:test(?:s|:[\w-]+)?|build|typecheck|lint|validate|check|compile)\b/i,
  /(?:^|[;&|]\s*)(?:pnpm|npm|yarn|bun)\s+(?:(?:run|exec)\s+)?(?:vitest|jest|pytest|tsc|eslint)\b/i,
  /(?:^|[;&|]\s*)(?:vitest|jest|pytest|cargo\s+test|go\s+test|dotnet\s+test|tsc)\b/i,
]

function commandText(args: unknown): string | undefined {
  const value = parsedArguments(args)
  if (typeof value !== 'object' || value === null || !('command' in value)) return undefined
  return typeof value.command === 'string' ? value.command : undefined
}

/**
 * Identify a recognized verification command: a `bash` or `pwsh` call whose
 * `command` argument runs a test, build, typecheck, or lint program.
 * @param call - one recorded tool call.
 * @returns true when the call is a recognized verification command.
 */
function isVerificationCall(call: RecordedCall): boolean {
  if (!VERIFICATION_TOOLS.has(call.name)) return false
  const command = commandText(call.args)
  return command !== undefined && VERIFICATION_COMMANDS.some(pattern => pattern.test(command))
}

/**
 * Check that at least one recognized verification command was recorded before
 * a sequence boundary and that every such command settled successfully.
 * @param events - session events to scan.
 * @param beforeSeq - only calls and results before this sequence number count.
 * @returns true when every recognized verification call before the boundary succeeded.
 */
export function hasSuccessfulVerification(
  events: readonly SessionEvent[],
  beforeSeq = Number.POSITIVE_INFINITY,
): boolean {
  const before = events.filter(event => event.seq < beforeSeq)
  const verificationCalls = new Set(recordedCalls(before).filter(isVerificationCall).map(call => call.callId))
  const succeeded = new Set<string>()
  for (const event of before) {
    const result = outcomeOf(event)
    if (result !== undefined && verificationCalls.has(result.callId) && !result.failed) succeeded.add(result.callId)
  }
  return verificationCalls.size > 0 && [...verificationCalls].every(callId => succeeded.has(callId))
}

/**
 * Identify an `update_goal` call whose arguments request completion.
 * @param call - one recorded tool call.
 * @returns true when the call asks to mark the goal complete.
 */
export function isCompletionCall(call: RecordedCall): boolean {
  if (call.name !== 'update_goal') return false
  const value = parsedArguments(call.args)
  return typeof value === 'object' && value !== null && 'action' in value && value.action === 'complete'
}

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

  const calls = recordedCalls(turnEvents)
  const toolNames = calls.map(call => call.name)

  // Signal: many tool calls but none are verification commands
  if (toolNames.length >= MIN_CALLS_FOR_VERIFICATION_CHECK
    && !hasSuccessfulVerification(turnEvents)) {
    signals.push({
      code: 'NO_VERIFICATION',
      description: `${toolNames.length} tool calls in this turn but no recognized verification command `
        + `completed successfully (${[...VERIFICATION_TOOLS].join(', ')}).`,
    })
  }

  // Signal: attempting update_goal(complete) without prior verification
  const completeAttempt = calls.find(isCompletionCall)
  if (completeAttempt !== undefined) {
    const verificationBeforeComplete = hasSuccessfulVerification(turnEvents, completeAttempt.seq)
    if (!verificationBeforeComplete) {
      signals.push({
        code: 'PREMATURE_COMPLETE',
        description: 'Attempted to mark goal complete without a successful recognized verification result earlier in this turn.',
      })
    }
  }

  // Signal: rapid turn closure (very few tool calls for a complex objective)
  if (goal.roundsStarted <= 2 && toolNames.length <= 1) {
    signals.push({
      code: 'INSUFFICIENT_WORK',
      description: `Only ${toolNames.length} tool call(s) in round ${goal.roundsStarted + 1} of a goal. `
        + 'Complex objectives require sustained multi-step work.',
    })
  }

  return signals
}
