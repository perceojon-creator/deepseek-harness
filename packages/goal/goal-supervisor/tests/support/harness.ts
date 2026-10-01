/** Composition harness that loads the real goal-supervisor plugin with goal, tool, and prompt services. */

import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { agentEvents, assembleContextFor, Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentStatus, PreStepDecision } from '@deepseek-ai/dsh-agent'
import GoalService from '@deepseek-ai/dsh-goal'
import type { GoalView } from '@deepseek-ai/dsh-goal'
import { createMessage, createToolResultMessage, createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmRuntime, MessageSource, StreamChunk, UserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import * as toolGoal from '@deepseek-ai/dsh-tool-goal'
import * as goalSupervisor from '../../src/index.ts'

/** Produces the supervisor model stream for one request. */
export type LlmBehavior = (options: GenerateOptions) => AsyncIterable<StreamChunk>

/** Stream one complete text response. */
export function respond(text: string): LlmBehavior {
  return () => (async function* () {
    yield { type: 'text-delta', index: 0, text } satisfies StreamChunk
    yield { type: 'finish', reason: { kind: 'stop' } } satisfies StreamChunk
  })()
}

/** Fail the request when the stream is consumed. */
export function fail(message: string): LlmBehavior {
  return () => (async function* () {
    await Promise.resolve()
    throw new Error(message)
  })()
}

/** Never produce output; reject once the request signal aborts. */
export function hangUntilAbort(): LlmBehavior {
  return options => (async function* () {
    const signal = options.signal
    if (signal === undefined) throw new Error('supervisor request carried no signal')
    await new Promise<never>((_, reject) => {
      signal.addEventListener('abort', () => { reject(new Error('aborted')) }, { once: true })
    })
    yield { type: 'finish', reason: { kind: 'stop' } } satisfies StreamChunk
  })()
}

/** One agent registered with the harness plus its observable side effects. */
export interface HarnessAgent {
  readonly agent: Agent
  readonly session: Session
  readonly steers: UserMessage[]
  setStatus(status: AgentStatus): void
  /** Unregister the agent, which emits `agent/disposed`. */
  dispose(): void
  /** Register the same agent object again after {@link dispose}. */
  reregister(): void
}

function stubAgent(rawId: string): HarnessAgent {
  const session = Session.create(SessionId(rawId))
  let status: AgentStatus = 'running'
  const steers: UserMessage[] = []
  const agent: Agent = {
    id: session.id,
    options: {},
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    get status() { return status },
    ctx: new Context(),
    send: () => {},
    followup: () => {},
    steer: (message) => {
      steers.push(message)
      return { outcome: Promise.resolve({ status: 'rejected' as const }) }
    },
    inject(input) {
      this.inbox.append('next-step', input)
    },
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle() { return Promise.resolve() },
  }
  return { agent, session, steers, setStatus(value) { status = value }, dispose() {}, reregister() {} }
}

interface LoggedMessage {
  readonly type: string
  readonly args: readonly unknown[]
}

/** Options for {@link SupervisorHarness.runTool}. */
interface RunToolOptions {
  readonly target?: HarnessAgent
  readonly signal?: AbortSignal
  /** Whether the execution names its agent; false runs an agent-less execution. */
  readonly withAgent?: boolean
}

/** Loaded composition plus helpers that record turns and drive the plugin's handlers. */
export interface SupervisorHarness {
  readonly ctx: Context
  readonly root: HarnessAgent
  /** Every options object passed to the supervisor model, in request order. */
  readonly requests: GenerateOptions[]
  /** Replace the supervisor model behavior for later requests. */
  setLlm(behavior: LlmBehavior): void
  /** Register another agent with the same plugin composition. */
  addAgent(rawId: string): HarnessAgent
  /** Logged warning texts. */
  warnings(): string[]
  /** Start a new turn with one admitted user message and return its number. */
  openTurn(target?: HarnessAgent, source?: MessageSource): number
  /** Record one completed tool call and its text result in the current turn. */
  recordTool(name: string, args: Record<string, unknown>, resultText: string, target?: HarnessAgent): void
  /** Record an assistant message with one reasoning block in the current turn. */
  recordReasoning(text: string, target?: HarnessAgent): void
  /** Dispatch `agent/turn-stopping` for the current turn. */
  stopTurn(target?: HarnessAgent, signal?: AbortSignal): Promise<void>
  /** Execute one goal tool through the tool runtime on the agent's behalf. */
  runTool(name: string, args: Record<string, unknown>, options?: RunToolOptions): Promise<ToolExecutionResult>
  /** Execute update_goal(complete) for the agent's goal through the tool runtime. */
  complete(goal: GoalView, target?: HarnessAgent, signal?: AbortSignal): Promise<ToolExecutionResult>
  /** Assemble the system prompt for one agent, or with no agent, and return a named section's text. */
  section(name: string, target?: HarnessAgent | null): Promise<string | undefined>
  /** Run `agent/pre-step` with the given messages and downstream decision. */
  preStep(messages: UserMessage[], downstream: PreStepDecision, target?: HarnessAgent): Promise<PreStepDecision>
  /** Admit a goal round through `agent/pre-step` and return the supervisor ledger text. */
  ledger(goal: GoalView, round: number, target?: HarnessAgent): Promise<string | undefined>
}

function currentTurn(session: Session): number {
  return session.events
    .filter(event => event.type === 'turn/start')
    .reduce((max, event) => Math.max(max, event.data.turn), 0)
}

/**
 * Load SystemPrompt, AgentRegistry, ToolRuntime, GoalService, tool-goal, a stub
 * LLM service, and the goal-supervisor plugin, then register one root agent.
 * @param behavior - initial supervisor model behavior.
 * @param config - goal-supervisor plugin configuration.
 * @returns the loaded harness.
 */
export async function supervisorHarness(
  behavior: LlmBehavior,
  config: Partial<goalSupervisor.Config> = {},
): Promise<SupervisorHarness> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(GoalService)
  await ctx.plugin(toolGoal)

  let current = behavior
  const requests: GenerateOptions[] = []
  ctx.provide('llm', {
    stream: (options: GenerateOptions) => {
      requests.push(options)
      return current(options)
    },
    listProviders: () => [{ id: 'mock', name: 'Mock' }],
  } as unknown as LlmRuntime)

  const logged: LoggedMessage[] = []
  ctx.logger.exporter({ levels: { default: 3 }, export: message => logged.push(message) })

  // Cordis resolves omitted fields through the plugin's Config schema defaults.
  await ctx.plugin(goalSupervisor, config as goalSupervisor.Config)

  const agents: HarnessAgent[] = []
  const addAgent = (rawId: string): HarnessAgent => {
    const base = stubAgent(rawId)
    let unregister = ctx.agents.register(base.agent)
    const stub: HarnessAgent = {
      ...base,
      dispose() { unregister() },
      reregister() { unregister = ctx.agents.register(base.agent) },
    }
    agents.push(stub)
    return stub
  }
  const root = addAgent(`test-agent-${Math.random()}`)
  const calls = new Map<Session, number>()

  const step = (target: HarnessAgent): { turn: number; step: number } => {
    const turn = currentTurn(target.session)
    const next = (calls.get(target.session) ?? 0) + 1
    calls.set(target.session, next)
    return { turn, step: next }
  }

  const runTool = (name: string, args: Record<string, unknown>, options: RunToolOptions = {}): Promise<ToolExecutionResult> => {
    const { target = root, signal = new AbortController().signal, withAgent = true } = options
    return ctx.agents.withInitiator(target.agent, () => ctx.tools.execute({
      callId: ToolCallId(`${name}-${Math.random()}`),
      name,
      arguments: args,
      ...withAgent ? { agent: target.agent } : {},
      signal,
    }))
  }
  const preStep = (messages: UserMessage[], downstream: PreStepDecision, target = root): Promise<PreStepDecision> =>
    agentEvents(ctx, target.agent).waterfall(
      'agent/pre-step',
      { messages, turn: currentTurn(target.session), step: 1, signal: new AbortController().signal },
      async () => downstream,
    )

  return {
    ctx,
    root,
    requests,
    setLlm(next) { current = next },
    addAgent,
    warnings() {
      return logged.filter(message => message.type === 'warn').map(message => message.args.map(String).join(' '))
    },
    openTurn(target = root, source = { kind: 'user' }) {
      const turn = currentTurn(target.session) + 1
      target.agent.inbox.append('next-turn', createUserMessage({ content: [{ type: 'text', text: 'prompt' }], source }))
      const claimed = target.agent.inbox.claim('next-turn', turn)
      target.session.append('turn/start', { turn })
      for (const admitted of claimed) target.session.append('user/message', admitted, { surfaceOp: 'append' })
      return turn
    },
    recordTool(name, args, resultText, target = root) {
      const position = step(target)
      const callId = ToolCallId(`call-${position.turn}-${position.step}`)
      target.session.append('step/start', position)
      target.session.append('tool/call', { ...position, callId, name, arguments: JSON.stringify(args) })
      target.session.append('tool/result', {
        ...position,
        message: createToolResultMessage({ callId, content: [{ type: 'text', text: resultText }], isError: false }),
      }, { surfaceOp: 'append' })
      target.session.append('step/end', position)
    },
    recordReasoning(text, target = root) {
      const position = step(target)
      target.session.append('step/start', position)
      target.session.append('assistant/message', {
        ...position,
        message: createMessage({
          role: 'assistant',
          content: [{ type: 'reasoning', text }, { type: 'text', text: 'Working.' }],
          source: { kind: 'model', provider: 'mock', model: 'test' },
        }),
      }, { surfaceOp: 'append' })
      target.session.append('step/end', position)
    },
    async stopTurn(target = root, signal = new AbortController().signal) {
      await agentEvents(ctx, target.agent).serial('agent/turn-stopping', { turn: currentTurn(target.session), signal })
    },
    runTool,
    complete(goal, target = root, signal) {
      return runTool('update_goal', { goal_id: goal.id, revision: goal.revision, action: 'complete' }, {
        target,
        ...signal === undefined ? {} : { signal },
      })
    },
    async section(name, target = root) {
      const assembly = await ctx.systemPrompt.assemble(target === null ? {} : assembleContextFor(target.agent))
      return assembly.sections.find(section => section.name === name)?.text
    },
    preStep,
    async ledger(goal, round, target = root) {
      const roundMessage = createUserMessage({
        content: [{ type: 'text', text: 'goal round prompt' }],
        source: { kind: 'goal', goalId: goal.id, revision: goal.revision, round },
      })
      const decision = await preStep([roundMessage], { kind: 'enter', messages: [roundMessage] }, target)
      if (decision.kind !== 'enter') return undefined
      const ledger = decision.messages.find(m => m.source.kind === 'plugin' && m.source.plugin === 'goal-supervisor')
      const block = ledger?.content[0]
      return block?.type === 'text' ? block.text : undefined
    },
  }
}

/**
 * Read the evaluator system prompts recorded in the session log.
 * @param session - the supervised agent's session.
 * @returns the system prompt of each logged evaluation request.
 */
export function evaluationPrompts(session: Session): string[] {
  return session.events.flatMap(event =>
    event.type === 'goal-supervisor/llm-request' && event.data.kind === 'evaluation' ? [event.data.system] : [])
}

/**
 * Text of each steer message delivered to a harness agent.
 * @param agent - the harness agent.
 * @returns steer texts in delivery order.
 */
export function steerTexts(agent: HarnessAgent): string[] {
  return agent.steers.map((message) => {
    const block = message.content[0]
    return block?.type === 'text' ? block.text : ''
  })
}
