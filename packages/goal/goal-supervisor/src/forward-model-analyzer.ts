/** Layer 3 extension — Cerebellar forward-model reasoning analysis. */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { EvasionSignal } from './types.ts'

/** Hedging patterns that predict low-quality work when they co-occur. */
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
 * Analyze the model's reasoning blocks for hedging and verification-avoidance
 * patterns that predict low-quality actions.
 * @param events - Session events from the current turn.
 * @param turnStartSeq - Sequence number of the turn start.
 * @returns The evasion signal if weak reasoning is detected, undefined otherwise.
 */
export function analyzeReasoningQuality(
  events: readonly SessionEvent[],
  turnStartSeq: number,
): EvasionSignal | undefined {
  const turnEvents = events.filter(e => e.seq > turnStartSeq)

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
  let hedgingCount = 0
  const matchedPatterns: string[] = []

  for (const pattern of HEDGING_PATTERNS) {
    if (pattern.test(fullReasoning)) {
      hedgingCount++
      const match = fullReasoning.match(pattern)
      if (match) matchedPatterns.push(match[0])
    }
  }

  if (hedgingCount >= MIN_HEDGING_DENSITY) {
    return {
      code: 'WEAK_REASONING',
      description: `Reasoning contains ${hedgingCount} hedging/avoidance indicators (${matchedPatterns.slice(0, 3).join('; ')}). `
        + 'This predicts unverified work — run concrete verification before proceeding.',
    }
  }

  return undefined
}
