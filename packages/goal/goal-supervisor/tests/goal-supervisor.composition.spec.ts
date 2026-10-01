import { describe, expect, it, vi } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { evaluationPrompts, fail, hangUntilAbort, respond, supervisorHarness } from './support/harness.ts'

const APPROVE = respond('{"action":"approve"}')
const REDIRECT = respond('{"action":"redirect","critique":"Review the remaining API behavior."}')

describe('dsh-goal-supervisor end-to-end composition', () => {
  it('renders the self-audit section only for the assembling agent with an active goal', async () => {
    const h = await supervisorHarness(APPROVE)
    const other = h.addAgent('other-agent')
    h.openTurn()
    expect(await h.section('supervisor:self-audit')).toBe('')

    h.ctx.goals.create(h.root.agent, { objective: 'Port C++ to Rust with bit-by-bit differential testing' })

    const text = await h.section('supervisor:self-audit')
    expect(text).toContain('<self_audit>')
    expect(text).toContain('Port C++ to Rust')
    expect(await h.section('supervisor:self-audit', other)).toBe('')
  })

  it('adds the progress ledger when a goal round is admitted', async () => {
    const h = await supervisorHarness(APPROVE)
    const goal = h.ctx.goals.create(h.root.agent, { objective: 'Verify compiler equivalence' })
    expect(await h.ledger(goal, 1)).toContain('<progress_ledger>')
  })

  it('denies completion after an unverified code change and keeps the goal active', async () => {
    const h = await supervisorHarness(APPROVE)
    h.openTurn()
    const goal = h.ctx.goals.create(h.root.agent, { objective: 'Test blocking' })
    h.recordTool('edit', { path: 'src/parser.ts' }, 'edited')

    const result = await h.complete(goal)

    expect(result.isError).toBe(true)
    expect((result.content[0] as { text?: string } | undefined)?.text).toContain('successful recorded recognized verification result')
    expect(h.ctx.goals.get(h.root.agent)).toMatchObject({ id: goal.id, phase: 'active' })
    expect(h.requests).toHaveLength(0)
  })

  it('lets the evaluator approve a goal that changed no code', async () => {
    const h = await supervisorHarness(APPROVE)
    h.openTurn()
    const goal = h.ctx.goals.create(h.root.agent, { objective: 'Summarize the design notes' })

    const result = await h.complete(goal)

    expect(result.isError).toBe(false)
    expect(h.ctx.goals.get(h.root.agent)).toMatchObject({ id: goal.id, phase: 'complete' })
    expect(h.requests).toHaveLength(1)
  })

  it('denies a goal that changed no code when the evaluator redirects', async () => {
    const h = await supervisorHarness(REDIRECT)
    h.openTurn()
    const goal = h.ctx.goals.create(h.root.agent, { objective: 'Summarize the design notes' })

    expect((await h.complete(goal)).isError).toBe(true)
    expect(h.ctx.goals.get(h.root.agent)?.phase).toBe('active')
  })

  it('allows completion of the exact goal revision approved by the evaluator', async () => {
    const h = await supervisorHarness(APPROVE)
    h.openTurn()
    const goal = h.ctx.goals.create(h.root.agent, { objective: 'Complete reviewed work' })
    h.recordTool('bash', { command: 'pnpm run test' }, '24 tests passed')

    const result = await h.complete(goal)

    expect(result.isError).toBe(false)
    expect(h.ctx.goals.get(h.root.agent)).toMatchObject({ id: goal.id, phase: 'complete' })
    expect(evaluationPrompts(h.root.session)[0]).toContain('24 tests passed')
    const supervisorResult = h.root.session.events.find(event => event.type === 'goal-supervisor/llm-result')
    expect(supervisorResult).toMatchObject({ data: { status: 'complete', response: '{"action":"approve"}' } })
  })

  it('keeps the goal active when the evaluator redirects verified work', async () => {
    const h = await supervisorHarness(REDIRECT)
    h.openTurn()
    const goal = h.ctx.goals.create(h.root.agent, { objective: 'Review completion criteria' })
    h.recordTool('bash', { command: 'pnpm run test' }, '24 tests passed')

    const result = await h.complete(goal)

    expect(result.isError).toBe(true)
    expect((result.content[0] as { text?: string } | undefined)?.text).toContain('Review the remaining API behavior.')
    expect(h.ctx.goals.get(h.root.agent)).toMatchObject({ id: goal.id, phase: 'active' })
  })

  it('denies completion when the verification command exited non-zero', async () => {
    const h = await supervisorHarness(APPROVE)
    h.openTurn()
    const goal = h.ctx.goals.create(h.root.agent, { objective: 'Fix the failing test' })
    h.recordTool('edit', { path: 'src/parser.ts' }, 'edited')
    h.recordTool('bash', { command: 'pnpm run test' }, '1 failed\n[exit code: 1]')

    expect((await h.complete(goal)).isError).toBe(true)
    expect(h.ctx.goals.get(h.root.agent)?.phase).toBe('active')
  })

  it('requires re-verification after a later code change and does not reuse turn-stopping approval', async () => {
    const h = await supervisorHarness(APPROVE)
    h.openTurn()
    const goal = h.ctx.goals.create(h.root.agent, { objective: 'Complete the current revision' })
    h.recordTool('bash', { command: 'pnpm run test' }, '24 tests passed')
    await h.stopTurn()

    h.openTurn()
    h.recordTool('write', { path: 'src/parser.ts' }, 'written')
    const result = await h.complete(goal)

    expect(result.isError).toBe(true)
    expect(h.ctx.goals.get(h.root.agent)).toMatchObject({ id: goal.id, phase: 'active' })
  })

  it('fails open on evaluator failure after verification succeeded', async () => {
    const h = await supervisorHarness(fail('provider unavailable'))
    h.openTurn()
    const goal = h.ctx.goals.create(h.root.agent, { objective: 'Complete despite evaluator outage' })
    h.recordTool('bash', { command: 'pnpm run test' }, '24 tests passed')

    const result = await h.complete(goal)

    expect(result.isError).toBe(false)
    expect(h.ctx.goals.get(h.root.agent)?.phase).toBe('complete')
    expect(h.root.session.events.find(event => event.type === 'goal-supervisor/llm-result'))
      .toMatchObject({ data: { status: 'failed' } })
    expect(h.warnings().some(text => text.includes('evaluator abstained'))).toBe(true)
  })

  it('carries a redirect salience list into the next round ledger and drops it after a goal edit', async () => {
    const h = await supervisorHarness(respond(
      '{"action":"redirect","critique":"Review the unverified module.",'
      + '"salience":[{"task":"module B bounds checks","risk":"critical"}]}',
    ))
    h.openTurn()
    const goal = h.ctx.goals.create(h.root.agent, { objective: 'Test salience' })
    expect(await h.ledger(goal, 1)).not.toContain('module B bounds checks')

    await h.stopTurn()

    expect(await h.ledger(goal, 2)).toContain('[CRITICAL]: "module B bounds checks"')
    const edited = h.ctx.goals.edit(h.root.agent, goal, { objective: 'A different objective' })
    expect(await h.ledger(edited, 3)).not.toContain('module B bounds checks')
  })

  it('renders no supervisor sections for an assembly without an agent', async () => {
    const h = await supervisorHarness(APPROVE)
    h.openTurn()
    h.ctx.goals.create(h.root.agent, { objective: 'Diagnostics assembly' })
    expect(await h.section('supervisor:self-audit', null)).toBe('')
    expect(await h.section('supervisor:episodic-memory', null)).toBe('')
  })

  it('leaves pre-step decisions unchanged for rejections, non-goal messages, and inactive goals', async () => {
    const h = await supervisorHarness(APPROVE)
    const userMessage = createUserMessage({ content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } })
    const roundless = await h.preStep([userMessage], { kind: 'enter', messages: [userMessage] })
    expect(roundless).toEqual({ kind: 'enter', messages: [userMessage] })

    const goal = h.ctx.goals.create(h.root.agent, { objective: 'Pre-step' })
    const reject = { kind: 'reject' as const, reason: 'downstream' }
    expect(await h.preStep([userMessage], reject)).toBe(reject)
    expect(await h.preStep([userMessage], { kind: 'enter', messages: [userMessage] }))
      .toEqual({ kind: 'enter', messages: [userMessage] })

    h.ctx.goals.pause(h.root.agent, goal)
    expect(await h.ledger(goal, 1)).toBeUndefined()
  })

  it('passes other goal tools and non-completion updates through the gate', async () => {
    const h = await supervisorHarness(REDIRECT)
    h.openTurn()
    const goal = h.ctx.goals.create(h.root.agent, { objective: 'Pass-through' })

    expect((await h.runTool('get_goal', {})).isError).toBe(false)
    const pause = await h.runTool('update_goal', { goal_id: goal.id, revision: goal.revision, action: 'pause' })
    expect(JSON.stringify(pause.content)).not.toContain('Goal completion blocked')
    expect(h.requests).toHaveLength(0)
  })

  it('denies completion requests that name another revision or omit identity', async () => {
    const h = await supervisorHarness(APPROVE)
    h.openTurn()
    const goal = h.ctx.goals.create(h.root.agent, { objective: 'Exact revision' })
    h.recordTool('bash', { command: 'pnpm run test' }, 'ok')

    const stale = await h.runTool('update_goal', { goal_id: goal.id, revision: goal.revision + 1, action: 'complete' })
    const missing = await h.runTool('update_goal', { action: 'complete' })

    for (const result of [stale, missing]) {
      expect(result.isError).toBe(true)
      expect(JSON.stringify(result.content)).toContain('does not match the active goal and revision')
    }
    expect(h.ctx.goals.get(h.root.agent)?.phase).toBe('active')
    expect(h.requests).toHaveLength(0)
  })

  it('denies completion when the evaluator abstains because the call was cancelled', async () => {
    const h = await supervisorHarness(hangUntilAbort())
    h.openTurn()
    const goal = h.ctx.goals.create(h.root.agent, { objective: 'Cancelled completion' })
    h.recordTool('bash', { command: 'pnpm run test' }, 'ok')
    const controller = new AbortController()

    const pending = h.complete(goal, h.root, controller.signal)
    await vi.waitFor(() => { expect(h.requests).toHaveLength(1) })
    controller.abort()

    expect((await pending).isError).toBe(true)
    expect(h.warnings().some(text => text.includes('evaluator abstained'))).toBe(false)
    expect(h.ctx.goals.get(h.root.agent)?.phase).toBe('active')
  })

  it('reads the whole log for verification when no turn has started', async () => {
    const h = await supervisorHarness(APPROVE)
    const goal = h.ctx.goals.create(h.root.agent, { objective: 'No turn' })
    h.recordTool('bash', { command: 'pnpm run test' }, 'ok')

    const result = await h.complete(goal)

    expect(h.requests).toHaveLength(1)
    expect(JSON.stringify(result.content)).toContain('goal tools require an open model turn')
  })

  it('forgets per-agent state when the agent is disposed', async () => {
    const h = await supervisorHarness(respond(
      '{"action":"redirect","critique":"x","salience":[{"task":"module C","risk":"high"}]}',
    ))
    h.openTurn()
    const goal = h.ctx.goals.create(h.root.agent, { objective: 'Dispose' })
    await h.stopTurn()
    expect(await h.ledger(goal, 1)).toContain('module C')

    h.root.dispose()
    h.root.reregister()

    expect(await h.ledger(goal, 1)).not.toContain('module C')
  })
})
