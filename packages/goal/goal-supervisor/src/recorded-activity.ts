/** Recorded tool calls, tool outcomes, and reasoning read from session events, shared by the supervisor checks. */

import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

/** One recorded tool call: a direct model call or a PTC sub-dispatch. */
export interface RecordedCall {
  /** Sequence number of the call event. */
  readonly seq: number
  /** Call id that pairs the call with its outcome. */
  readonly callId: string
  /** Tool name. */
  readonly name: string
  /** Recorded arguments: JSON text for a direct call, the dispatched value for a sub-dispatch. */
  readonly args: unknown
}

/** One recorded tool outcome. */
export interface RecordedOutcome {
  /** Sequence number of the result event. */
  readonly seq: number
  /** Call id of the call this outcome settles. */
  readonly callId: string
  /** Tool name for a sub-dispatch; undefined for a direct result, which records only the call id. */
  readonly name: string | undefined
  /** Text blocks of the result joined by newlines. */
  readonly text: string
  /** Whether the result is an error, carries failure identity, or ends with a failing shell marker. */
  readonly failed: boolean
  /** Failure code: the recorded error code, `TOOL_ERROR` for an error result, otherwise `EXIT_ERROR`. */
  readonly errorCode: string
}

/**
 * Shell-tool failure markers: a final non-zero `[exit code: N]` line, a
 * `[killed by signal: X]` marker, or a `[timed out after Nms]` marker.
 */
const FAILURE_MARKER = /(?:^|\n)\[exit code: (?!0\])\d+\]$|\[(?:killed by signal: [^\]]+|timed out after \d+ms)\]/

function joinText(content: readonly ContentBlock[]): string {
  return content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
}

function outcome(
  seq: number,
  callId: string,
  name: string | undefined,
  content: readonly ContentBlock[],
  isError: boolean,
  recordedCode: string | undefined,
): RecordedOutcome {
  const text = joinText(content)
  return {
    seq,
    callId,
    name,
    text,
    failed: isError || recordedCode !== undefined || FAILURE_MARKER.test(text),
    errorCode: recordedCode ?? (isError ? 'TOOL_ERROR' : 'EXIT_ERROR'),
  }
}

/**
 * Read the call recorded by one event, including the `run_code` transport call.
 * @param event - one session event.
 * @returns the call, or undefined for a non-call event.
 */
export function callOf(event: SessionEvent): RecordedCall | undefined {
  if (event.type === 'tool/call') {
    return { seq: event.seq, callId: event.data.callId, name: event.data.name, args: event.data.arguments }
  }
  if (event.type === 'tool/code-dispatch-start') {
    return { seq: event.seq, callId: event.data.subCallId, name: event.data.name, args: event.data.arguments }
  }
  return undefined
}

/**
 * Read the outcome recorded by one event.
 * @param event - one session event.
 * @returns the outcome of a tool result or sub-dispatch result; undefined for other events.
 */
export function outcomeOf(event: SessionEvent): RecordedOutcome | undefined {
  if (event.type === 'tool/result') {
    const [block] = event.data.message.content
    return outcome(event.seq, block.toolCallId, undefined, block.content, block.isError === true, event.data.error?.code)
  }
  if (event.type === 'tool/code-dispatch') {
    return outcome(event.seq, event.data.subCallId, event.data.name, event.data.content, event.data.isError, undefined)
  }
  return undefined
}

/**
 * List direct tool calls (excluding the `run_code` transport) and PTC sub-dispatches.
 * @param events - session events to scan.
 * @returns the recorded calls in log order.
 */
export function recordedCalls(events: readonly SessionEvent[]): RecordedCall[] {
  return events.flatMap((event) => {
    const call = callOf(event)
    return call === undefined || (event.type === 'tool/call' && call.name === 'run_code') ? [] : [call]
  })
}

/**
 * Parse JSON-text arguments; return other values unchanged.
 * @param raw - recorded arguments.
 * @returns the parsed value, or undefined when JSON text does not parse.
 */
export function parsedArguments(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw
  try {
    return JSON.parse(raw)
  } catch {
    // Malformed model JSON has no fields to read; the owning tool rejects it.
    return undefined
  }
}

/**
 * Join the reasoning blocks of assistant messages.
 * @param events - session events to scan.
 * @returns reasoning texts joined by spaces; empty when no reasoning was recorded.
 */
export function reasoningText(events: readonly SessionEvent[]): string {
  return events.flatMap(event => event.type === 'assistant/message'
    ? event.data.message.content.flatMap(block => block.type === 'reasoning' ? [block.text] : [])
    : []).join(' ')
}
