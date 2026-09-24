import { describe, expect, it } from 'vitest'
import {
  parseVerdict,
  resolveSupervisorModel,
  streamToText,
} from '../src/supervisor-call.ts'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'

describe('parseVerdict', () => {
  it('parses valid approve JSON', () => {
    const verdict = parseVerdict('{"action": "approve"}')
    expect(verdict.action).toBe('approve')
    expect(verdict.layer).toBe(4)
  })

  it('parses valid redirect JSON with critique', () => {
    const verdict = parseVerdict('{"action": "redirect", "critique": "You did not run tests on module B."}')
    expect(verdict.action).toBe('redirect')
    expect(verdict.critique).toBe('You did not run tests on module B.')
    expect(verdict.layer).toBe(4)
  })

  it('fails closed on non-JSON text', () => {
    const verdict = parseVerdict('I think it looks good')
    expect(verdict.action).toBe('redirect')
    expect(verdict.critique).toContain('not parseable JSON')
  })

  it('fails closed on invalid JSON structure', () => {
    const verdict = parseVerdict('{invalid json}')
    expect(verdict.action).toBe('redirect')
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
    })
    expect(result).toEqual({ provider: 'session-provider', model: 'session-model' })
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
