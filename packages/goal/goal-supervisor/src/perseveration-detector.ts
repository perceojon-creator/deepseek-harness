/** Layer 3 extension — repeated-failure (perseveration) detector, inspired by orbitofrontal response inhibition. */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { EvasionSignal, TurnErrorSignature } from './types.ts'
import { outcomeOf, recordedCalls } from './recorded-activity.ts'

/** Minimum consecutive identical-error turns before firing. */
export const PERSEVERATION_THRESHOLD = 3

/**
 * Compute a stable signature from the failed tool results in one turn.
 * The signature captures tool name, failure code, and the first 200
 * characters of output, ignoring call ids and timestamps so that identical
 * retry patterns produce identical signatures.
 * @param events - Session events to scan.
 * @param turnStartSeq - Sequence number of the turn start.
 * @returns The signature string, or undefined if no tool result failed.
 */
export function computeErrorSignature(
  events: readonly SessionEvent[],
  turnStartSeq: number,
): TurnErrorSignature | undefined {
  const turnEvents = events.filter(e => e.seq > turnStartSeq)
  const callNames = new Map(recordedCalls(turnEvents).map(call => [call.callId, call.name]))
  const errorParts: string[] = []
  for (const event of turnEvents) {
    const result = outcomeOf(event)
    if (result === undefined || !result.failed) continue
    const toolName = result.name ?? callNames.get(result.callId) ?? 'unknown'
    errorParts.push(`${toolName}:${result.errorCode}:${result.text.slice(0, 200)}`)
  }
  if (errorParts.length === 0) return undefined
  errorParts.sort()
  return errorParts.join('|') as TurnErrorSignature
}

/**
 * Track error signatures across turns and detect perseveration: the same
 * failing tool-result pattern recurring in consecutive turns. A turn may be
 * recorded several times (each turn-stopping pass of a steered turn); the
 * latest recording of a turn replaces its earlier ones.
 */
export class PerseverationTracker {
  private lastSignature: TurnErrorSignature | undefined
  private consecutiveCount = 0
  private pending: { readonly turn: number; readonly signature: TurnErrorSignature | undefined } | undefined

  /**
   * Record the error signature for one turn.
   * @param events - Session events from the turn.
   * @param turnStartSeq - Sequence number of the turn start.
   * @param turn - Turn number being recorded.
   */
  recordTurn(events: readonly SessionEvent[], turnStartSeq: number, turn: number): void {
    if (this.pending !== undefined && this.pending.turn !== turn) {
      const folded = this.fold(this.pending.signature)
      this.lastSignature = folded.signature
      this.consecutiveCount = folded.count
    }
    this.pending = { turn, signature: computeErrorSignature(events, turnStartSeq) }
  }

  private fold(signature: TurnErrorSignature | undefined): { signature: TurnErrorSignature | undefined; count: number } {
    if (signature === undefined) return { signature: undefined, count: 0 }
    return { signature, count: signature === this.lastSignature ? this.consecutiveCount + 1 : 1 }
  }

  /**
   * Check whether the perseveration threshold has been reached.
   * @returns The evasion signal if the threshold is met, undefined otherwise.
   */
  detect(): EvasionSignal | undefined {
    const count = this.pending === undefined ? this.consecutiveCount : this.fold(this.pending.signature).count
    if (count >= PERSEVERATION_THRESHOLD) {
      return {
        code: 'PERSEVERATION',
        description: `${count} consecutive turns produced the same error pattern. The current strategy has failed repeatedly — investigate the root cause or try a different approach before retrying.`,
      }
    }
    return undefined
  }

  /** Reset all perseveration tracking state. */
  reset(): void {
    this.lastSignature = undefined
    this.consecutiveCount = 0
    this.pending = undefined
  }
}
