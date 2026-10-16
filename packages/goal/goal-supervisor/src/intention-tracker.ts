/** Layer 3 extension — intention-drift heuristic: stated verification commitments versus recorded results. */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { EvasionSignal } from './types.ts'
import { hasSuccessfulVerification } from './evasion-detector.ts'
import { reasoningText } from './recorded-activity.ts'

/** First-person or imperative commitment that introduces a planned action. */
const COMMITMENT = String.raw`(?:\bI(?:['’]ll|\s+will|\s+am\s+going\s+to|['’]m\s+going\s+to|\s+need\s+to|\s+must)|\blet\s+me|\blet['’]s|\b(?:next|then|now),?(?:\s+I(?:['’]ll|\s+will))?)`

/** Verification targets that a run/execute commitment must name. */
const VERIFICATION_TARGET = String.raw`(?:tests?|specs?|test\s+suite|suite|build|typecheck|type-check|lint(?:er)?|compiler|vitest|jest|pytest|tsc|cargo\s+test|go\s+test|npm\s+test|pnpm\s+test|make\s+check)`

/**
 * Verification commitments in natural-language reasoning: a commitment phrase
 * ("I will", "let me", "next,") immediately followed by a verification verb
 * and target, such as "I will run the tests" or "let me compile".
 */
export const VERIFICATION_INTENT_PATTERNS: readonly RegExp[] = [
  new RegExp(String.raw`${COMMITMENT}\s+(?:re-?run|run|execute|invoke)\s+(?:the\s+|all\s+|a\s+)?(?:[\w-]+\s+)?${VERIFICATION_TARGET}\b`, 'gi'),
  new RegExp(String.raw`${COMMITMENT}\s+(?:compile|build|typecheck|test)\b`, 'gi'),
  new RegExp(String.raw`${COMMITMENT}\s+(?:verify|validate)\s+(?:the\s+)?(?:output|result|binary|build|compilation)`, 'gi'),
]

/** Negation inside the clause before a commitment cancels it ("I won't…", "no need to…"). */
const CLAUSE_NEGATION = /\b(?:not|never|no|without|skip(?:ping)?|instead\s+of)\b|n['’]t\b/i

function negatedInClause(text: string, matchIndex: number, matchText: string): boolean {
  const before = text.slice(0, matchIndex)
  const clauseStart = Math.max(...['.', '!', '?', ';', '\n'].map(mark => before.lastIndexOf(mark))) + 1
  return CLAUSE_NEGATION.test(text.slice(clauseStart, matchIndex) + ' ' + matchText)
}

/**
 * Extract verification commitments from reasoning text, ignoring commitments
 * negated in their own clause.
 * @param reasoningText - The model's reasoning/thinking content.
 * @returns Distinct matched commitment phrases.
 */
export function extractPlannedTools(reasoningText: string): string[] {
  const found: string[] = []
  for (const pattern of VERIFICATION_INTENT_PATTERNS) {
    for (const match of reasoningText.matchAll(pattern)) {
      if (!negatedInClause(reasoningText, match.index, match[0])) found.push(match[0])
    }
  }
  return [...new Set(found)]
}

/**
 * Compare verification commitments stated in the current turn's reasoning
 * blocks with the turn's recorded verification results.
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
    const plannedVerification = extractPlannedTools(reasoningText(turnEvents))
    if (plannedVerification.length === 0 || hasSuccessfulVerification(turnEvents)) return undefined
    return {
      code: 'INTENTION_DRIFT',
      description: `The model's reasoning promised verification (${plannedVerification.slice(0, 3).join(', ')}) but no successful verification command result was recorded.`,
    }
  }
}
