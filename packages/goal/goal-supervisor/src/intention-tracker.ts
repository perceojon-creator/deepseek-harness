/** Layer 3 extension — Intention drift detector (VTA dopaminergic δ). */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { EvasionSignal } from './types.ts'
import { VERIFICATION_TOOLS } from './evasion-detector.ts'

/**
 * Verification-intent patterns in natural language reasoning.
 * Matches phrases like "run tests", "compile", "cargo test", "execute", "verify".
 */
export const VERIFICATION_INTENT_PATTERNS: readonly RegExp[] = [
  /\b(?:run|execute|invoke)\s+(?:the\s+)?(?:test|spec|suite|build|cargo\s+test|npm\s+test|pnpm\s+test|make\s+check)/i,
  /\bpnpm\s+vitest\b/i,
  /\b(?:compile|build)\b/i,
  /\b(?:verify|validate|check)\s+(?:the\s+)?(?:output|result|binary|build|compilation)/i,
  /\bpwsh\b/i,
  /\brun_code\b/i,
  /\bbash\b/i,
  /\bcargo\s+test\b/i,
]

/**
 * Extract planned verification tool usage from reasoning text.
 * @param reasoningText - The model's reasoning/thinking content.
 * @returns Tool names or verification actions the model declared it would perform.
 */
export function extractPlannedTools(reasoningText: string): string[] {
  const found: string[] = []
  for (const pattern of VERIFICATION_INTENT_PATTERNS) {
    if (pattern.test(reasoningText)) {
      const match = reasoningText.match(pattern)
      if (match) found.push(match[0])
    }
  }
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
   * @param events - Session events from the current turn.
   * @param turnStartSeq - Sequence number of the turn start.
   * @returns The evasion signal if drift is detected, undefined otherwise.
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
