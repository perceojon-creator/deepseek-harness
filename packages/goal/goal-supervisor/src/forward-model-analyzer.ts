/**
 * Layer 3 extension — hedging-phrase heuristic over reasoning text. Named after
 * the cerebellar forward-model idea; it counts regex matches and predicts nothing.
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { hasSuccessfulVerification } from './evasion-detector.ts'
import { reasoningText } from './recorded-activity.ts'
import type { EvasionSignal } from './types.ts'

/** Hedging and verification-avoidance phrases counted by {@link analyzeReasoningQuality}. */
export const HEDGING_PATTERNS: readonly RegExp[] = [
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
export const MIN_HEDGING_DENSITY = 2

/**
 * Count distinct hedging and verification-avoidance phrases in the current
 * turn's reasoning blocks when the turn has no successful verification result.
 * @param events - Session events from the current turn.
 * @param turnStartSeq - Sequence number of the turn start.
 * @returns The evasion signal if weak reasoning is detected, undefined otherwise.
 */
export function analyzeReasoningQuality(
  events: readonly SessionEvent[],
  turnStartSeq: number,
): EvasionSignal | undefined {
  const turnEvents = events.filter(e => e.seq > turnStartSeq)
  if (hasSuccessfulVerification(turnEvents)) return undefined

  const fullReasoning = reasoningText(turnEvents)
  const matchedPatterns: string[] = []
  for (const pattern of HEDGING_PATTERNS) {
    const match = pattern.exec(fullReasoning)
    if (match) matchedPatterns.push(match[0])
  }
  const hedgingCount = matchedPatterns.length

  if (hedgingCount >= MIN_HEDGING_DENSITY) {
    return {
      code: 'WEAK_REASONING',
      description: `Reasoning contains ${hedgingCount} hedging/avoidance indicators (${matchedPatterns.slice(0, 3).join('; ')}). `
        + 'No successful verification result is recorded in this turn — run concrete verification before proceeding.',
    }
  }

  return undefined
}
