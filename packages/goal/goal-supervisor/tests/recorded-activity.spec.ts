import { describe, expect, it } from 'vitest'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { callOf, outcomeOf, parsedArguments, reasoningText, recordedCalls } from '../src/recorded-activity.ts'

function toolResult(
  seq: number,
  callId: string,
  content: unknown[],
  isError: boolean,
  error?: { name: string; code: string },
): SessionEvent {
  return {
    type: 'tool/result',
    seq,
    data: {
      turn: 1,
      step: 1,
      message: { role: 'user', content: [{ type: 'tool-result', toolCallId: ToolCallId(callId), content, isError }] },
      ...error === undefined ? {} : { error },
    },
  } as unknown as SessionEvent
}

describe('recorded activity', () => {
  it('reads direct calls and sub-dispatches but excludes the run_code transport from recorded calls', () => {
    const events = [
      { type: 'tool/call', seq: 1, data: { turn: 1, step: 1, callId: ToolCallId('run'), name: 'run_code', arguments: '{}' } },
      { type: 'tool/code-dispatch-start', seq: 2, data: { rootCallId: 'run', parentCallId: 'run', subCallId: 'run:code:1', name: 'bash', arguments: { command: 'ls' } } },
      { type: 'turn/start', seq: 3, data: { turn: 2 } },
    ] as unknown as SessionEvent[]
    expect(callOf(events[0]!)?.name).toBe('run_code')
    expect(callOf(events[2]!)).toBeUndefined()
    expect(recordedCalls(events)).toEqual([{ seq: 2, callId: 'run:code:1', name: 'bash', args: { command: 'ls' } }])
  })

  it('classifies outcomes by error flag, recorded error code, and shell failure markers', () => {
    expect(outcomeOf(toolResult(1, 'a', [{ type: 'text', text: 'ok' }], false))).toMatchObject({ failed: false })
    expect(outcomeOf(toolResult(1, 'a', [{ type: 'text', text: 'bad' }], true))).toMatchObject({ failed: true, errorCode: 'TOOL_ERROR' })
    expect(outcomeOf(toolResult(1, 'a', [], false, { name: 'E', code: 'EXEC_FAILED' })))
      .toMatchObject({ failed: true, errorCode: 'EXEC_FAILED' })
    expect(outcomeOf(toolResult(1, 'a', [{ type: 'text', text: 'x\n[killed by signal: SIGKILL]' }], false)))
      .toMatchObject({ failed: true, errorCode: 'EXIT_ERROR' })
    expect(outcomeOf(toolResult(1, 'a', [{ type: 'text', text: 'done\n[exit code: 0]' }], false))).toMatchObject({ failed: false })
  })

  it('joins only the text blocks of a result', () => {
    const image = { type: 'image', attachment: {} }
    expect(outcomeOf(toolResult(1, 'a', [{ type: 'text', text: 'one' }, image, { type: 'text', text: 'two' }], false))?.text)
      .toBe('one\ntwo')
  })

  it('returns undefined for events without outcomes', () => {
    expect(outcomeOf({ type: 'turn/start', seq: 1, data: { turn: 1 } } as unknown as SessionEvent)).toBeUndefined()
  })

  it('parses JSON-text arguments and passes other values through', () => {
    expect(parsedArguments('{"a":1}')).toEqual({ a: 1 })
    expect(parsedArguments('{not json')).toBeUndefined()
    expect(parsedArguments({ a: 1 })).toEqual({ a: 1 })
  })

  it('joins reasoning blocks of assistant messages only', () => {
    const events = [
      { type: 'assistant/message', seq: 1, data: { message: { content: [{ type: 'reasoning', text: 'first' }, { type: 'text', text: 'visible' }] } } },
      { type: 'assistant/message', seq: 2, data: { message: { content: [{ type: 'reasoning', text: 'second' }] } } },
      { type: 'turn/start', seq: 3, data: { turn: 1 } },
    ] as unknown as SessionEvent[]
    expect(reasoningText(events)).toBe('first second')
  })
})
