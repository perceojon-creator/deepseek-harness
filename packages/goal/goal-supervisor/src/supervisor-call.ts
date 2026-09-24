/** Layer 4 — LLM supervisor evaluation call. */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { GoalView } from '@deepseek-ai/dsh-goal'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, GenerateOptions, StreamChunk, TextBlock } from '@deepseek-ai/dsh-llm'
import type { EvasionSignal, SupervisorVerdict } from './types.ts'
import { renderSupervisorPrompt } from './supervisor-prompt.ts'

export interface SupervisorConfig {
  readonly supervisorProvider?: string
  readonly supervisorModel?: string
}

/**
 * Extract a compact session summary from the agent's recent events.
 * Includes reasoning blocks when available (reading the model's thoughts).
 */
export function extractSessionSummary(agent: Agent, turnStartSeq: number): string {
  const events = agent.session.events.filter(e => e.seq > turnStartSeq)
  const parts: string[] = []

  for (const event of events.slice(-30)) {
    if (event.type === 'tool/call') {
      parts.push(`Tool: ${event.data.name}(${String(event.data.arguments).slice(0, 200)})`)
    }
    if (event.type === 'assistant/message') {
      const message = (event.data as { message: { content: readonly ContentBlock[] } }).message
      for (const block of message.content ?? []) {
        if (block.type === 'reasoning' && block.text) {
          parts.push(`Reasoning: ${block.text.slice(0, 500)}`)
        }
        if (block.type === 'text' && block.text) {
          parts.push(`Output: ${block.text.slice(0, 300)}`)
        }
      }
    }
  }

  return parts.join('\n') || '(no recent activity recorded)'
}

/**
 * Resolve the supervisor's provider/model, cascading from config to session active.
 */
export function resolveSupervisorModel(
  ctx: Context,
  agent: Agent,
  config: SupervisorConfig,
): { provider: string; model: string } {
  const available = new Set(ctx.llm.listProviders().map(p => p.id))

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
 * Parse the supervisor's JSON response into a verdict.
 */
export function parseVerdict(text: string): SupervisorVerdict {
  const jsonMatch = text.match(/\{[^{}]+\}/)
  if (!jsonMatch) {
    return {
      action: 'redirect',
      critique: 'Supervisor response was not parseable JSON — defaulting to redirect. Raw: ' + text.slice(0, 200),
      layer: 4,
    }
  }
  try {
    const parsed = JSON.parse(jsonMatch[0]) as { action?: string; critique?: string }
    if (parsed.action === 'approve') return { action: 'approve', layer: 4 }
    return {
      action: 'redirect',
      critique: parsed.critique ?? 'Supervisor rejected completion without specific critique.',
      layer: 4,
    }
  } catch {
    return {
      action: 'redirect',
      critique: 'Supervisor JSON parse failed — defaulting to redirect.',
      layer: 4,
    }
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
 * @returns the supervisor's verdict.
 */
export async function evaluateWithSupervisor(
  ctx: Context,
  agent: Agent,
  goal: GoalView,
  signals: readonly EvasionSignal[],
  config: SupervisorConfig,
  turnStartSeq: number,
): Promise<SupervisorVerdict> {
  const { provider, model } = resolveSupervisorModel(ctx, agent, config)
  const sessionSummary = extractSessionSummary(agent, turnStartSeq)
  const systemPrompt = renderSupervisorPrompt(goal.objective, sessionSummary, signals)

  const options: GenerateOptions = {
    provider,
    model,
    system: systemPrompt,
    messages: [createUserMessage({
      content: [{ type: 'text', text: 'Evaluate the agent state now.' }],
      source: { kind: 'plugin', plugin: 'goal-supervisor' },
    })],
    temperature: 0,
    maxTokens: 500,
  }

  try {
    const text = await streamToText(ctx.llm.stream(options))
    return parseVerdict(text)
  } catch (error: unknown) {
    ctx.logger.warn(`goal-supervisor: supervisor LLM call failed: ${error instanceof Error ? error.message : String(error)}`)
    // Fail-closed: if the supervisor can't evaluate, redirect
    return {
      action: 'redirect',
      critique: 'Supervisor LLM call failed — cannot certify completion. Continue working.',
      layer: 4,
    }
  }
}
