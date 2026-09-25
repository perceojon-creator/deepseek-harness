/** Layer 3 extension — Perseveration detector (orbitofrontal cortex). */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { EvasionSignal, TurnErrorSignature } from './types.ts'

/** Minimum consecutive identical-error turns before firing. */
export const PERSEVERATION_THRESHOLD = 3

/**
 * Compute a stable signature from the error-bearing tool results in one turn.
 * The signature captures tool name + error text content, ignoring call IDs and
 * timestamps so that identical retry patterns hash identically.
 * @param events - Session events to scan.
 * @param turnStartSeq - Sequence number of the turn start.
 * @returns The signature string, or undefined if no errors occurred.
 */
export function computeErrorSignature(
  events: readonly SessionEvent[],
  turnStartSeq: number,
): TurnErrorSignature | undefined {
  const turnEvents = events.filter(e => e.seq > turnStartSeq)

  // Build a map of callId -> tool name from tool/call events
  const callNames = new Map<string, string>()
  for (const event of turnEvents) {
    if (event.type === 'tool/call') {
      callNames.set(event.data.callId, event.data.name)
    }
  }

  // Collect error fingerprints from tool/result events
  const errorParts: string[] = []
  for (const event of turnEvents) {
    if (event.type !== 'tool/result') continue
    const data = event.data as {
      message: { content: readonly { type: string; isError?: boolean; content?: readonly { type: string; text?: string }[] }[] }
      error?: { name: string; code: string }
    }
    if (!data.error) continue

    const resultBlock = data.message.content[0]
    if (resultBlock?.type !== 'tool-result') continue

    const errorTexts = (resultBlock.content ?? [])
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text' && typeof b.text === 'string')
      .map(b => b.text)

    // Normalize: tool name + error code + first 200 chars of error text
    const callId = (resultBlock as { toolCallId?: string }).toolCallId ?? ''
    const toolName = callNames.get(callId) ?? 'unknown'
    errorParts.push(`${toolName}:${data.error.code}:${errorTexts.join('').slice(0, 200)}`)
  }

  if (errorParts.length === 0) return undefined

  errorParts.sort()
  return errorParts.join('|') as TurnErrorSignature
}

/**
 * Track error signatures across turns and detect perseveration — the
 * orbitofrontal cortex's failure to inhibit a strategy that has already
 * failed repeatedly.
 */
export class PerseverationTracker {
  private lastSignature: TurnErrorSignature | undefined
  private consecutiveCount = 0

  /**
   * Record the error signature for the most recent turn.
   * @param events - Session events from the turn.
   * @param turnStartSeq - Sequence number of the turn start.
   */
  recordTurn(events: readonly SessionEvent[], turnStartSeq: number): void {
    const sig = computeErrorSignature(events, turnStartSeq)
    if (sig === undefined) {
      this.lastSignature = undefined
      this.consecutiveCount = 0
      return
    }
    if (sig === this.lastSignature) {
      this.consecutiveCount++
    } else {
      this.lastSignature = sig
      this.consecutiveCount = 1
    }
  }

  /**
   * Check whether the perseveration threshold has been reached.
   * @returns The evasion signal if the threshold is met, undefined otherwise.
   */
  detect(): EvasionSignal | undefined {
    if (this.consecutiveCount >= PERSEVERATION_THRESHOLD) {
      return {
        code: 'PERSEVERATION',
        description: `${this.consecutiveCount} consecutive turns produced the same error pattern. The current strategy has failed repeatedly — investigate the root cause or try a different approach before retrying.`,
      }
    }
    return undefined
  }

  /** Reset all perseveration tracking state. */
  reset(): void {
    this.lastSignature = undefined
    this.consecutiveCount = 0
  }
}
