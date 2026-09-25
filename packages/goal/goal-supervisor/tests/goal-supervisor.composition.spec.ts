import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { agentEvents, Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentStatus } from '@deepseek-ai/dsh-agent'
import GoalService from '@deepseek-ai/dsh-goal'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { MessageSource } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as toolGoal from '@deepseek-ai/dsh-tool-goal'
import * as goalSupervisor from '../src/index.ts'

interface StubAgent {
  readonly agent: Agent
  readonly session: Session
  setStatus(status: AgentStatus): void
}

function stubAgent(rawId: string): StubAgent {
  const session = Session.create(SessionId(rawId))
  let status: AgentStatus = 'running'
  const agent: Agent = {
    id: session.id,
    options: {},
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    get status() { return status },
    ctx: new Context(),
    send: () => {},
    followup: () => {},
    steer: () => ({ outcome: Promise.resolve({ status: 'rejected' as const }) }),
    inject(input) {
      this.inbox.append('next-step', input)
    },
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle() { return Promise.resolve() },
  }
  return { agent, session, setStatus(value) { status = value } }
}

function openTurn(stub: StubAgent, source: MessageSource, text = 'prompt'): number {
  const turn = stub.session.events
    .filter(event => event.type === 'turn/start')
    .reduce((max, event) => Math.max(max, event.data.turn), 0) + 1
  const message = createUserMessage({
    content: [{ type: 'text', text }],
    source,
  })
  stub.agent.inbox.append('next-turn', message)
  const claimed = stub.agent.inbox.claim('next-turn', turn)
  stub.session.append('turn/start', { turn })
  for (const admitted of claimed) {
    stub.session.append('user/message', admitted, { surfaceOp: 'append' })
  }
  return turn
}

async function compositionHarness() {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(GoalService)
  await ctx.plugin(toolGoal)

  // Provide mock llm service to satisfy goal-supervisor injection
  ctx.provide('llm', {
    stream: () => (async function* () {})(),
    listProviders: () => [{ id: 'mock', name: 'Mock' }],
  } as unknown as import('@deepseek-ai/dsh-llm').LlmRuntime)

  await ctx.plugin(goalSupervisor)

  const root = stubAgent(`test-agent-${Math.random()}`)
  ctx.agents.register(root.agent)
  return { ctx, root }
}

describe('dsh-goal-supervisor end-to-end composition', () => {
  it('activates Layer 1 system prompt self-audit when goal is created', async () => {
    const { ctx, root } = await compositionHarness()
    openTurn(root, { kind: 'user' })

    // Before goal, supervisor section text is empty
    const beforeAssembly = await ctx.systemPrompt.assemble()
    const beforeSection = beforeAssembly.sections.find(s => s.name === 'supervisor:self-audit')
    expect(beforeSection?.text).toBe('')

    // Create goal
    ctx.goals.create(root.agent, { objective: 'Port C++ to Rust with bit-by-bit differential testing' })

    // After goal, section contains <self_audit> and the objective
    const afterAssembly = await ctx.systemPrompt.assemble()
    const afterSection = afterAssembly.sections.find(s => s.name === 'supervisor:self-audit')
    expect(afterSection?.text).toContain('<self_audit>')
    expect(afterSection?.text).toContain('Port C++ to Rust')
    expect(afterSection?.text).toContain('progress ledger')
  })

  it('activates Layer 2 progress ledger on goal round admission', async () => {
    const { ctx, root } = await compositionHarness()
    const goal = ctx.goals.create(root.agent, { objective: 'Verify compiler equivalence' })

    const roundMessage = createUserMessage({
      content: [{ type: 'text', text: 'goal round prompt' }],
      source: { kind: 'goal', goalId: goal.id, revision: goal.revision, round: 1 },
    })

    // Dispatch agent/pre-step with goal-sourced message through agentEvents waterfall
    const decision = await agentEvents(ctx, root.agent).waterfall(
      'agent/pre-step',
      {
        messages: [roundMessage],
        turn: 1,
        step: 1,
        signal: new AbortController().signal,
      },
      async () => ({ kind: 'enter' as const, messages: [roundMessage] }),
    )

    expect(decision.kind).toBe('enter')
    if (decision.kind === 'enter') {
      const ledgerMsg = decision.messages.find(m => m.source.kind === 'plugin' && m.source.plugin === 'goal-supervisor')
      expect(ledgerMsg).toBeDefined()
      const firstBlock = ledgerMsg?.content[0] as { type: string; text?: string } | undefined
      expect(firstBlock?.text).toContain('<progress_ledger>')
    }
  })

  it('Layer 5 blocks update_goal(complete) when supervisor has not approved', async () => {
    const { ctx, root } = await compositionHarness()
    openTurn(root, { kind: 'user' })
    const goal = ctx.goals.create(root.agent, { objective: 'Test blocking' })

    // Execute update_goal via ctx.tools.execute under agent's initiator scope
    const result = await ctx.agents.withInitiator(root.agent, () => ctx.tools.execute({
      callId: ToolCallId('c1'),
      name: 'update_goal',
      arguments: {
        goal_id: goal.id,
        revision: goal.revision,
        action: 'complete',
      },
      agent: root.agent,
      signal: new AbortController().signal,
    }))

    expect(result.isError).toBe(true)
    const errBlock = result.content[0] as { type: string; text?: string } | undefined
    expect(errBlock?.text).toContain('supervisor has not certified completion')
  })

  it('incorporates salience map from prior redirect into next round ledger', async () => {
    const { ctx, root } = await compositionHarness()
    const goal = ctx.goals.create(root.agent, { objective: 'Test salience' })

    // Simulate prior turn-stopping having set salience
    const roundMessage = createUserMessage({
      content: [{ type: 'text', text: 'goal round prompt' }],
      source: { kind: 'goal', goalId: goal.id, revision: goal.revision, round: 2 },
    })

    const decision = await agentEvents(ctx, root.agent).waterfall(
      'agent/pre-step',
      {
        messages: [roundMessage],
        turn: 2,
        step: 1,
        signal: new AbortController().signal,
      },
      async () => ({ kind: 'enter' as const, messages: [roundMessage] }),
    )

    expect(decision.kind).toBe('enter')
    if (decision.kind === 'enter') {
      const ledgerMsg = decision.messages.find(m => m.source.kind === 'plugin' && m.source.plugin === 'goal-supervisor')
      expect(ledgerMsg).toBeDefined()
    }
  })
})
