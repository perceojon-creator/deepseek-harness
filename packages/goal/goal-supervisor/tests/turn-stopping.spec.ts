import { describe, expect, it } from 'vitest'
import { fail, hangUntilAbort, respond, steerTexts, supervisorHarness } from './support/harness.ts'

const APPROVE = respond('{"action":"approve"}')
const REDIRECT = respond('{"action":"redirect","critique":"Review the remaining API behavior."}')

describe('turn-stopping steering', () => {
  it('steers with the evaluator critique on redirect', async () => {
    const h = await supervisorHarness(REDIRECT)
    h.openTurn()
    h.ctx.goals.create(h.root.agent, { objective: 'Finish the API' })

    await h.stopTurn()

    expect(steerTexts(h.root)).toEqual(['[Metacognitive Supervisor]: Review the remaining API behavior.'])
  })

  it('stops steering after the configured redirect budget and lets the turn end', async () => {
    const h = await supervisorHarness(REDIRECT, { maxConsecutiveRedirects: 2 })
    h.openTurn()
    const goal = h.ctx.goals.create(h.root.agent, { objective: 'Never satisfied' })

    for (let attempt = 0; attempt < 5; attempt++) await h.stopTurn()

    expect(h.root.steers).toHaveLength(2)
    expect(h.requests).toHaveLength(2)
    expect(h.warnings().some(text => text.includes('redirect budget of 2 exhausted'))).toBe(true)
    expect(h.ctx.goals.get(h.root.agent)).toMatchObject({ id: goal.id, phase: 'active' })

    h.openTurn()
    await h.stopTurn()
    expect(h.root.steers).toHaveLength(3)
  })

  it('applies the default budget of three steers per turn', async () => {
    const h = await supervisorHarness(REDIRECT)
    h.openTurn()
    h.ctx.goals.create(h.root.agent, { objective: 'Never satisfied' })
    for (let attempt = 0; attempt < 6; attempt++) await h.stopTurn()
    expect(h.root.steers).toHaveLength(3)
  })

  it('does not steer when the evaluator call fails', async () => {
    const h = await supervisorHarness(fail('rate limited'))
    h.openTurn()
    h.ctx.goals.create(h.root.agent, { objective: 'Research the API surface' })
    h.recordTool('read', { path: 'README.md' }, 'contents')

    await h.stopTurn()

    expect(h.root.steers).toHaveLength(0)
    expect(h.warnings().some(text => text.includes('abstaining'))).toBe(true)
  })

  it('does not steer when the evaluator response is not a parseable verdict', async () => {
    const h = await supervisorHarness(respond('Looks fine to me.'))
    h.openTurn()
    h.ctx.goals.create(h.root.agent, { objective: 'Summarize the design' })

    await h.stopTurn()

    expect(h.root.steers).toHaveLength(0)
  })

  it('does not require shell verification for a turn without code changes', async () => {
    const h = await supervisorHarness(APPROVE)
    h.openTurn()
    h.ctx.goals.create(h.root.agent, { objective: 'Write a research summary' })
    h.recordTool('read', { path: 'docs/architecture.md' }, 'architecture')

    await h.stopTurn()

    expect(h.root.steers).toHaveLength(0)
  })

  it('steers for verification after code changes even when the evaluator approves', async () => {
    const h = await supervisorHarness(APPROVE)
    h.openTurn()
    h.ctx.goals.create(h.root.agent, { objective: 'Fix the parser' })
    h.recordTool('edit', { path: 'src/parser.ts' }, 'edited')

    await h.stopTurn()
    expect(steerTexts(h.root)[0]).toContain('changed code without a successful recorded verification command after the last change')

    h.recordTool('bash', { command: 'pnpm vitest run' }, 'all passed')
    await h.stopTurn()
    expect(h.root.steers).toHaveLength(1)
  })

  it('does not steer once the turn signal is aborted', async () => {
    const h = await supervisorHarness(REDIRECT)
    h.openTurn()
    h.ctx.goals.create(h.root.agent, { objective: 'Cancelled work' })
    const controller = new AbortController()
    controller.abort()

    await h.stopTurn(h.root, controller.signal)

    expect(h.root.steers).toHaveLength(0)
    expect(h.requests[0]?.signal?.aborted).toBe(true)
  })

  it('aborts a hung evaluator request after the configured timeout', async () => {
    const h = await supervisorHarness(hangUntilAbort(), { supervisorTimeoutMs: 1_000 })
    h.openTurn()
    h.ctx.goals.create(h.root.agent, { objective: 'Slow provider' })

    await h.stopTurn()

    expect(h.root.steers).toHaveLength(0)
    expect(h.requests[0]?.signal?.aborted).toBe(true)
  })

  it('does nothing without an active goal', async () => {
    const h = await supervisorHarness(REDIRECT)
    h.openTurn()
    await h.stopTurn()
    expect(h.requests).toHaveLength(0)
    expect(h.root.steers).toHaveLength(0)
  })

  it('starts a new budget when the goal revision changes within the turn', async () => {
    const h = await supervisorHarness(REDIRECT, { maxConsecutiveRedirects: 1 })
    h.openTurn()
    const goal = h.ctx.goals.create(h.root.agent, { objective: 'Original' })
    await h.stopTurn()
    await h.stopTurn()
    expect(h.root.steers).toHaveLength(1)

    h.ctx.goals.edit(h.root.agent, goal, { objective: 'Edited' })
    await h.stopTurn()

    expect(h.root.steers).toHaveLength(2)
  })
})
