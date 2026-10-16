import { describe, expect, it } from 'vitest'
import {
  extractSessionSummary,
  parseVerdict,
  resolveSupervisorModel,
  streamToText,
} from '../src/supervisor-call.ts'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

describe('extractSessionSummary', () => {
  it('includes successful and failed tool output for the evaluator', () => {
    const callId = ToolCallId('verify-call')
    const failedCallId = ToolCallId('failed-verify-call')
    const events = [
      {
        type: 'tool/call',
        seq: 1,
        data: { turn: 1, step: 1, callId, name: 'bash', arguments: '{"command":"pnpm run test"}' },
      },
      {
        type: 'tool/result',
        seq: 2,
        data: {
          turn: 1,
          step: 1,
          message: {
            role: 'user',
            content: [{
              type: 'tool-result',
              toolCallId: callId,
              content: [{ type: 'text', text: '24 tests passed' }],
              isError: false,
            }],
          },
        },
      },
      {
        type: 'tool/call',
        seq: 3,
        data: { turn: 1, step: 2, callId: failedCallId, name: 'bash', arguments: '{"command":"pnpm run typecheck"}' },
      },
      {
        type: 'tool/result',
        seq: 4,
        data: {
          turn: 1,
          step: 2,
          message: {
            role: 'user',
            content: [{
              type: 'tool-result',
              toolCallId: failedCallId,
              content: [{ type: 'text', text: 'type errors found\n[exit code: 1]' }],
              isError: false,
            }],
          },
        },
      },
    ] as unknown as SessionEvent[]
    const paddedEvents = [
      ...events,
      ...Array.from({ length: 35 }, (_, index) => ({
        type: 'step/end',
        seq: index + 5,
        data: { turn: 1, step: index + 1 },
      })),
    ] as unknown as SessionEvent[]
    const agent = { session: { events: paddedEvents } } as unknown as import('@deepseek-ai/dsh-agent').Agent

    const summary = extractSessionSummary(agent, 0, 12_000)

    expect(summary).toContain('Tool result (bash, succeeded): 24 tests passed')
    expect(summary).toContain('pnpm run test')
    expect(summary).toContain('Tool result (bash, failed): type errors found')
  })

  it('includes PTC sub-tool calls and outcomes for the evaluator', () => {
    const subCallId = ToolCallId('run:code:1')
    const events = [
      {
        type: 'tool/code-dispatch-start',
        seq: 1,
        data: {
          rootCallId: ToolCallId('run'),
          parentCallId: ToolCallId('run'),
          subCallId,
          name: 'bash',
          arguments: { command: 'pnpm run typecheck' },
        },
      },
      {
        type: 'tool/code-dispatch',
        seq: 2,
        data: {
          rootCallId: ToolCallId('run'),
          parentCallId: ToolCallId('run'),
          subCallId,
          name: 'bash',
          arguments: { command: 'pnpm run typecheck' },
          isError: false,
          content: [{ type: 'text', text: 'Typecheck passed' }],
        },
      },
    ] as unknown as SessionEvent[]
    const agent = { session: { events } } as unknown as import('@deepseek-ai/dsh-agent').Agent

    const summary = extractSessionSummary(agent, 0, 12_000)

    expect(summary).toContain('Sub-tool call: bash(')
    expect(summary).toContain('Sub-tool result (bash, succeeded): Typecheck passed')
  })

  it('keeps the complete summary within its configured character limit', () => {
    const events = Array.from({ length: 4 }, (_, index) => ({
      type: 'assistant/message',
      seq: index + 1,
      data: {
        message: {
          content: [{ type: 'text', text: `output-${index}-${'x'.repeat(100)}` }],
        },
      },
    })) as unknown as SessionEvent[]
    const agent = { session: { events } } as unknown as import('@deepseek-ai/dsh-agent').Agent

    expect(extractSessionSummary(agent, 0, 80)).toHaveLength(80)
  })
})

describe('extractSessionSummary edge cases', () => {
  it('labels results without a recorded call and results without text', () => {
    const events = [
      {
        type: 'tool/result',
        seq: 1,
        data: { turn: 1, step: 1, message: { role: 'user', content: [{ type: 'tool-result', toolCallId: ToolCallId('orphan'), content: [] }] } },
      },
    ] as unknown as SessionEvent[]
    const agent = { session: { events } } as unknown as import('@deepseek-ai/dsh-agent').Agent
    expect(extractSessionSummary(agent, 0, 12_000)).toBe('Tool result (unknown tool, succeeded): (no text output)')
  })

  it('reports an empty window and truncates below the omission marker length', () => {
    const empty = { session: { events: [] } } as unknown as import('@deepseek-ai/dsh-agent').Agent
    expect(extractSessionSummary(empty, 0, 12_000)).toBe('(no recent activity recorded)')
    expect(extractSessionSummary(empty, 0, 5)).toBe('rded)')
  })
})

describe('parseVerdict', () => {
  it('abstains when a closing brace precedes the opening brace', () => {
    expect(parseVerdict('} then {')).toMatchObject({ action: 'abstain', reason: 'Supervisor response contained no JSON object.' })
  })

  it('supplies a critique when a redirect omits one', () => {
    expect(parseVerdict('{"action":"redirect"}')).toEqual({
      action: 'redirect',
      critique: 'Supervisor rejected completion without specific critique.',
      layer: 4,
    })
  })

  it('keeps valid salience entries, defaults unknown risk, and drops invalid entries', () => {
    const verdict = parseVerdict(JSON.stringify({
      action: 'redirect',
      critique: 'c',
      salience: [null, 3, {}, { task: 7 }, { task: '   ' }, { task: ' keep ', risk: 'high' }, { task: 'odd', risk: 'severe' }, { task: 'bare' }],
    }))
    expect(verdict).toMatchObject({
      salience: [{ task: 'keep', risk: 'high' }, { task: 'odd', risk: 'medium' }, { task: 'bare', risk: 'medium' }],
    })
    expect(parseVerdict('{"action":"redirect","critique":"c","salience":[{}]}')).not.toHaveProperty('salience')
    expect(parseVerdict('{"action":"redirect","critique":"c","salience":"x"}')).not.toHaveProperty('salience')
  })

  it('parses valid approve JSON', () => {
    const verdict = parseVerdict('{"action": "approve"}')
    expect(verdict.action).toBe('approve')
    expect(verdict.layer).toBe(4)
  })

  it('parses valid redirect JSON with critique', () => {
    const verdict = parseVerdict('{"action": "redirect", "critique": "You did not run tests on module B."}')
    expect(verdict).toMatchObject({ action: 'redirect', critique: 'You did not run tests on module B.' })
    expect(verdict.layer).toBe(4)
  })

  it('abstains on non-JSON text', () => {
    const verdict = parseVerdict('I think it looks good')
    expect(verdict).toMatchObject({ action: 'abstain', reason: 'Supervisor response contained no JSON object.' })
  })

  it('abstains on invalid JSON structure', () => {
    expect(parseVerdict('{invalid json}')).toMatchObject({ action: 'abstain', reason: 'Supervisor JSON parse failed.' })
  })

  it('abstains on a JSON value without a recognized action', () => {
    expect(parseVerdict('{"critique": "unclear"}')).toMatchObject({ action: 'abstain' })
  })
})

describe('resolveSupervisorModel', () => {
  const fakeAgent = {
    options: { provider: 'session-provider', model: 'session-model' },
  } as unknown as import('@deepseek-ai/dsh-agent').Agent

  it('prefers configured provider when available in ctx.llm', () => {
    const fakeCtx = {
      llm: {
        listProviders: () => [{ id: 'anthropic', name: 'Anthropic' }],
      },
    } as unknown as import('@deepseek-ai/cordis').Context

    const result = resolveSupervisorModel(fakeCtx, fakeAgent, {
      supervisorProvider: 'anthropic',
      supervisorModel: 'claude-sonnet-4-5',
      sessionSummaryMaxChars: 12_000,
      supervisorTimeoutMs: 60_000,
    })
    expect(result).toEqual({ provider: 'anthropic', model: 'claude-sonnet-4-5' })
  })

  it('falls back to session provider when configured is not registered', () => {
    const fakeCtx = {
      llm: {
        listProviders: () => [{ id: 'deepseek', name: 'DeepSeek' }],
      },
    } as unknown as import('@deepseek-ai/cordis').Context

    const result = resolveSupervisorModel(fakeCtx, fakeAgent, {
      supervisorProvider: 'anthropic',
      supervisorModel: 'claude-sonnet-4-5',
      sessionSummaryMaxChars: 12_000,
      supervisorTimeoutMs: 60_000,
    })
    expect(result).toEqual({ provider: 'session-provider', model: 'session-model' })
  })
})

describe('resolveSupervisorModel fallbacks', () => {
  it('uses the first registered provider and a placeholder model when the agent names neither', () => {
    const agent = { options: {} } as unknown as import('@deepseek-ai/dsh-agent').Agent
    const config = { sessionSummaryMaxChars: 12_000, supervisorTimeoutMs: 60_000 }
    const withProviders = { llm: { listProviders: () => [{ id: 'first', name: 'First' }] } } as unknown as import('@deepseek-ai/cordis').Context
    const withoutProviders = { llm: { listProviders: () => [] } } as unknown as import('@deepseek-ai/cordis').Context
    expect(resolveSupervisorModel(withProviders, agent, config)).toEqual({ provider: 'first', model: 'default' })
    expect(resolveSupervisorModel(withoutProviders, agent, config)).toEqual({ provider: 'default', model: 'default' })
  })
})

describe('streamToText', () => {
  it('assembles text chunks in order', async () => {
    async function* chunks(): AsyncIterable<StreamChunk> {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: '{"action":' }
      yield { type: 'text-delta', index: 0, text: ' "approve"}' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: '{"action": "approve"}' } }
    }
    const text = await streamToText(chunks())
    expect(text).toBe('{"action": "approve"}')
  })
})
