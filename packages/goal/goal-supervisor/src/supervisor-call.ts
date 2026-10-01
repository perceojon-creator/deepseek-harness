/** Layer 4 — LLM supervisor evaluation call. */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { GoalView } from '@deepseek-ai/dsh-goal'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk, TextBlock } from '@deepseek-ai/dsh-llm'
import { callOf, outcomeOf } from './recorded-activity.ts'
import type { EvasionSignal, SalienceEntry, SupervisorVerdict } from './types.ts'
import { renderSupervisorPrompt } from './supervisor-prompt.ts'
import './session-events.ts'

/** Configuration options for the LLM supervisor provider and model. */
export interface SupervisorConfig {
  /** Optional provider override for the supervisor. */
  readonly supervisorProvider?: string
  /** Optional model override for the supervisor. */
  readonly supervisorModel?: string
  /** Maximum characters of session activity included in the evaluator request. */
  readonly sessionSummaryMaxChars: number
  /** Milliseconds one supervisor model request may run before it is aborted. */
  readonly supervisorTimeoutMs: number
}

/**
 * Fuse the caller's cancellation with the supervisor request timeout.
 * @param signal - cancellation owned by the turn or tool call that requested the evaluation.
 * @param timeoutMs - maximum request duration.
 * @returns a signal that aborts on caller cancellation or after `timeoutMs`.
 */
export function supervisorRequestSignal(signal: AbortSignal, timeoutMs: number): AbortSignal {
  return AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
}

/**
 * Extract a compact summary of the current turn, including recorded tool results.
 * @param agent - The agent instance whose session is being summarized.
 * @param afterSeq - Include events whose sequence follows this value.
 * @param maxChars - Maximum characters returned from the activity summary.
 * @returns Formatted summary string of recent session activity.
 */
export function extractSessionSummary(agent: Agent, afterSeq: number, maxChars: number): string {
  const events = agent.session.events.filter(e => e.seq > afterSeq)
  const parts: string[] = []
  const callNames = new Map(events.flatMap((event) => {
    const call = callOf(event)
    return call === undefined ? [] : [[call.callId, call.name] as const]
  }))

  for (const event of events) {
    const call = callOf(event)
    if (call !== undefined) {
      const label = event.type === 'tool/call' ? 'Tool' : 'Sub-tool call'
      const args = typeof call.args === 'string' ? call.args : JSON.stringify(call.args)
      parts.push(`${label}: ${call.name}(${args.slice(0, 200)})`)
    }
    const result = outcomeOf(event)
    if (result !== undefined) {
      const label = result.name === undefined ? 'Tool result' : 'Sub-tool result'
      const toolName = result.name ?? callNames.get(result.callId) ?? 'unknown tool'
      const status = result.failed ? 'failed' : 'succeeded'
      const detail = result.text.length > 0 ? result.text.slice(0, 1200) : '(no text output)'
      parts.push(`${label} (${toolName}, ${status}): ${detail}`)
    }
    if (event.type === 'assistant/message') {
      for (const block of event.data.message.content) {
        if (block.type === 'reasoning') parts.push(`Reasoning: ${block.text.slice(0, 500)}`)
        if (block.type === 'text') parts.push(`Output: ${block.text.slice(0, 300)}`)
      }
    }
  }

  const summary = parts.join('\n') || '(no recent activity recorded)'
  if (summary.length <= maxChars) return summary
  const marker = '[Earlier activity omitted. Latest activity follows.]\n'
  if (maxChars <= marker.length) return summary.slice(-maxChars)
  return marker + summary.slice(-(maxChars - marker.length))
}

/**
 * Resolve the supervisor's provider/model, cascading from config to session active.
 * @param ctx - The Cordis context with LLM service.
 * @param agent - The active agent whose configuration provides fallbacks.
 * @param config - The supervisor configuration options.
 * @returns The resolved provider and model identifiers.
 */
export function resolveSupervisorModel(
  ctx: Context,
  agent: Agent,
  config: SupervisorConfig,
): { provider: string; model: string } {
  const available = new Set(ctx.llm.listProviders().map(provider => provider.id))

  if (config.supervisorProvider && available.has(config.supervisorProvider)
    && config.supervisorModel) {
    return { provider: config.supervisorProvider, model: config.supervisorModel }
  }

  // Fallback: use the agent's active provider/model
  const provider = agent.options.provider ?? ctx.llm.listProviders()[0]?.id ?? 'default'
  const model = agent.options.model ?? 'default'
  return { provider, model }
}

/**
 * Consume a stream into assembled text.
 * @param stream - The stream of LLM chunks to collect.
 * @returns The assembled plain text from all text blocks.
 */
export async function streamToText(
  stream: AsyncIterable<StreamChunk>,
): Promise<string> {
  const assembler = new BlockAssembler()
  for await (const chunk of stream) {
    assembler.push(chunk)
  }
  return assembler.blocks()
    .filter((b): b is TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('')
}

/**
 * Run and durably record one auxiliary supervisor model request and response.
 * @param ctx - Cordis context with the LLM service.
 * @param agent - agent whose session records the request and result events.
 * @param options - request options; `system` and `maxTokens` are recorded verbatim.
 * @param kind - which supervisor request this is.
 * @param userText - text of the single user message in `options.messages`.
 * @returns the assembled response text; rejects after recording a failed result.
 */
export async function loggedStreamToText(
  ctx: Context,
  agent: Agent,
  options: GenerateOptions & { readonly system: string; readonly maxTokens: number },
  kind: 'evaluation' | 'consolidation',
  userText: string,
): Promise<string> {
  const request = agent.session.append('goal-supervisor/llm-request', {
    kind,
    provider: options.provider,
    model: options.model,
    system: options.system,
    userText,
    temperature: 0,
    maxTokens: options.maxTokens,
  })
  try {
    const response = await streamToText(ctx.llm.stream(options))
    agent.session.append('goal-supervisor/llm-result', {
      requestSeq: request.seq,
      status: 'complete',
      response,
    })
    return response
  } catch (error: unknown) {
    agent.session.append('goal-supervisor/llm-result', {
      requestSeq: request.seq,
      status: 'failed',
    })
    throw error
  }
}

const RISKS: ReadonlySet<unknown> = new Set(['critical', 'high', 'medium', 'low'])

/** Read valid salience entries; drop entries without a non-empty string task and default unknown risks to medium. */
function salienceEntries(value: unknown): SalienceEntry[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item: unknown) => {
    if (typeof item !== 'object' || item === null || !('task' in item) || typeof item.task !== 'string') return []
    const task = item.task.trim().slice(0, 500)
    const risk = 'risk' in item && RISKS.has(item.risk) ? item.risk as SalienceEntry['risk'] : 'medium'
    return task.length === 0 ? [] : [{ task, risk }]
  })
}

/**
 * Parse the supervisor's JSON response into a verdict. A response without a
 * JSON object, or whose `action` is neither `approve` nor `redirect`, yields
 * `abstain` rather than a redirect.
 * @param text - The raw LLM response text containing JSON verdict.
 * @returns The parsed supervisor verdict.
 */
export function parseVerdict(text: string): SupervisorVerdict {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end < start) {
    return { action: 'abstain', reason: 'Supervisor response contained no JSON object.', layer: 4 }
  }
  const candidate = text.slice(start, end + 1)
  // Text from the first `{` to the last `}` parses to an object or throws.
  let record: Record<string, unknown>
  try {
    record = JSON.parse(candidate) as Record<string, unknown>
  } catch {
    // A malformed JSON object is an unusable verdict, not a rejection.
    return { action: 'abstain', reason: 'Supervisor JSON parse failed.', layer: 4 }
  }
  if (record.action === 'approve') return { action: 'approve', layer: 4 }
  if (record.action !== 'redirect') {
    return { action: 'abstain', reason: 'Supervisor JSON had no recognized action.', layer: 4 }
  }

  const salience = salienceEntries(record.salience)
  return {
    action: 'redirect',
    critique: typeof record.critique === 'string'
      ? record.critique
      : 'Supervisor rejected completion without specific critique.',
    layer: 4,
    ...(salience.length > 0 ? { salience } : {}),
  }
}

/**
 * Evaluate the agent's current state via a one-shot supervisor LLM call.
 * @param ctx - Cordis context with llm service.
 * @param agent - the agent being supervised.
 * @param goal - the active goal.
 * @param signals - Layer 3 evasion signals.
 * @param config - supervisor model configuration.
 * @param turnStartSeq - sequence number of the turn start.
 * @param signal - cancellation of the turn or tool call requesting the evaluation.
 * @returns the supervisor's verdict; `abstain` when the request fails, times out, or is cancelled.
 */
export async function evaluateWithSupervisor(
  ctx: Context,
  agent: Agent,
  goal: GoalView,
  signals: readonly EvasionSignal[],
  config: SupervisorConfig,
  turnStartSeq: number,
  signal: AbortSignal,
): Promise<SupervisorVerdict> {
  const { provider, model } = resolveSupervisorModel(ctx, agent, config)
  const sessionSummary = extractSessionSummary(agent, turnStartSeq, config.sessionSummaryMaxChars)
  const systemPrompt = renderSupervisorPrompt(goal.objective, sessionSummary, signals)

  const userText = 'Evaluate the agent state now.'
  const options = {
    provider,
    model,
    system: systemPrompt,
    messages: [createUserMessage({
      content: [{ type: 'text', text: userText }],
      source: { kind: 'plugin', plugin: 'goal-supervisor' },
    })],
    temperature: 0,
    maxTokens: 500,
    signal: supervisorRequestSignal(signal, config.supervisorTimeoutMs),
  }

  try {
    const text = await loggedStreamToText(ctx, agent, options, 'evaluation', userText)
    return parseVerdict(text)
  } catch (error: unknown) {
    ctx.logger.warn(`goal-supervisor: supervisor LLM call failed; abstaining: ${String(error)}`)
    return { action: 'abstain', reason: `Supervisor LLM call failed: ${String(error)}`, layer: 4 }
  }
}
