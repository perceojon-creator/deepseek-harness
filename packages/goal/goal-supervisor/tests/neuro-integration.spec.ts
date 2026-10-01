import { describe, expect, it } from 'vitest'
import { evaluationPrompts, respond, steerTexts, supervisorHarness } from './support/harness.ts'

const REDIRECT = respond('{"action":"redirect","critique":"Fix the root cause before retrying."}')

describe('multi-turn supervision through the loaded plugin', () => {
  it('reports perseveration after three turns with the same non-zero bash exit', async () => {
    const h = await supervisorHarness(REDIRECT)
    const goal = h.ctx.goals.create(h.root.agent, { objective: 'Make the parser tests pass' })

    for (let turn = 1; turn <= 3; turn++) {
      h.openTurn(h.root, { kind: 'goal', goalId: goal.id, revision: goal.revision, round: turn })
      h.recordTool('bash', { command: 'pnpm vitest run parser' }, 'error[E0308]: mismatched types\n[exit code: 1]')
      await h.stopTurn()
    }

    const prompts = evaluationPrompts(h.root.session)
    expect(prompts).toHaveLength(3)
    expect(prompts[1]).not.toContain('[PERSEVERATION]')
    expect(prompts[2]).toContain('[PERSEVERATION]')
    expect(steerTexts(h.root)).toHaveLength(3)
  })

  it('does not count repeated stop attempts of one turn as perseveration', async () => {
    const h = await supervisorHarness(REDIRECT)
    h.ctx.goals.create(h.root.agent, { objective: 'Make the parser tests pass' })
    h.openTurn()
    h.recordTool('bash', { command: 'pnpm vitest run parser' }, 'boom\n[exit code: 1]')

    for (let attempt = 0; attempt < 3; attempt++) await h.stopTurn()

    expect(evaluationPrompts(h.root.session).some(prompt => prompt.includes('[PERSEVERATION]'))).toBe(false)
  })

  it('reports intention drift for a stated verification commitment without a result', async () => {
    const h = await supervisorHarness(REDIRECT)
    h.ctx.goals.create(h.root.agent, { objective: 'Port the module' })
    h.openTurn()
    h.recordReasoning('I will run the tests after this edit.')
    h.recordTool('edit', { path: 'src/module.rs' }, 'edited')

    await h.stopTurn()

    expect(evaluationPrompts(h.root.session)[0]).toContain('[INTENTION_DRIFT]')
  })

  it('does not report intention drift for a negated verification statement', async () => {
    const h = await supervisorHarness(REDIRECT)
    h.ctx.goals.create(h.root.agent, { objective: 'Update the README' })
    h.openTurn()
    h.recordReasoning("I don't need to run tests for a README wording change. The bash tool output was fine.")
    h.recordTool('read', { path: 'README.md' }, 'contents')

    await h.stopTurn()

    expect(evaluationPrompts(h.root.session)[0]).not.toContain('[INTENTION_DRIFT]')
  })

  it('reports hedging phrases and premature completion through the completion gate', async () => {
    const h = await supervisorHarness(REDIRECT)
    const goal = h.ctx.goals.create(h.root.agent, { objective: 'Port the module' })
    h.openTurn()
    h.recordReasoning('This should probably work. I will just mark this as complete without running anything.')
    h.recordTool('write', { path: 'a.rs' }, 'ok')
    h.recordTool('write', { path: 'b.rs' }, 'ok')
    h.recordTool('edit', { path: 'c.rs' }, 'ok')

    expect((await h.complete(goal)).isError).toBe(true)
    h.recordTool('update_goal', { goal_id: goal.id, revision: goal.revision, action: 'complete' }, 'denied')
    await h.stopTurn()

    const prompt = evaluationPrompts(h.root.session)[0]
    expect(prompt).toContain('[WEAK_REASONING]')
    expect(prompt).toContain('[NO_VERIFICATION]')
    expect(prompt).toContain('[PREMATURE_COMPLETE]')
    expect(h.ctx.goals.get(h.root.agent)?.phase).toBe('active')
  })

  it('consolidates at the configured round interval and renders the summary for the agent', async () => {
    const h = await supervisorHarness(respond('<episodic_consolidation>Verified: parser</episodic_consolidation>'), { consolidationInterval: 1 })
    const goal = h.ctx.goals.create(h.root.agent, { objective: 'Long goal' })
    h.openTurn(h.root, { kind: 'goal', goalId: goal.id, revision: goal.revision, round: 1 })

    await h.stopTurn()

    expect(await h.section('supervisor:episodic-memory')).toContain('Verified: parser')
  })
})
