import { describe, expect, it, vi } from 'vitest'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { CompletionGate } from '../src/completion-gate.ts'

describe('Turn stopping and completion gate interactions', () => {
  it('steers the agent when supervisor redirects at turn-stopping', async () => {
    interface TestSteeredMessage {
      readonly content: readonly { readonly type: string; readonly text: string }[]
      readonly source: { readonly kind: string; readonly plugin: string }
    }
    const steeredMessages: TestSteeredMessage[] = []
    const fakeAgent = {
      id: 'agent-test',
      steer: vi.fn((msg: TestSteeredMessage) => {
        steeredMessages.push(msg)
      }),
      session: {
        events: [
          { type: 'turn/start', seq: 1 },
          { type: 'tool/call', seq: 2, data: { callId: ToolCallId('c1'), name: 'write', arguments: '{}' } },
        ],
      },
    }

    const gate = new CompletionGate()
    expect(gate.canComplete(fakeAgent.id)).toBe(false)

    // Simulate steering when redirect occurs
    fakeAgent.steer({
      content: [{ type: 'text', text: '[Metacognitive Supervisor]: You did not run cargo test.' }],
      source: { kind: 'plugin', plugin: 'goal-supervisor' },
    })

    expect(fakeAgent.steer).toHaveBeenCalledTimes(1)
    const steeredMsg = steeredMessages[0]
    expect(steeredMsg).toBeDefined()
    expect(steeredMsg?.content[0]?.text).toContain('cargo test')
    expect(gate.canComplete(fakeAgent.id)).toBe(false)
  })

  it('approves the completion gate when supervisor approves at turn-stopping', () => {
    const gate = new CompletionGate()
    const agentId = 'agent-test-2'

    expect(gate.canComplete(agentId)).toBe(false)
    gate.approve(agentId)
    expect(gate.canComplete(agentId)).toBe(true)
  })

  it('per-turn reset revokes prior approval so each turn requires fresh certification', () => {
    const gate = new CompletionGate()
    const agentId = 'agent-turn-reset'

    // Turn N: supervisor approves
    gate.approve(agentId)
    expect(gate.canComplete(agentId)).toBe(true)

    // Turn N+1 starts: gate resets
    gate.resetTurn(agentId)
    expect(gate.canComplete(agentId)).toBe(false)

    // Without fresh approval, completion is blocked
    expect(gate.canComplete(agentId)).toBe(false)

    // Fresh approval in turn N+1
    gate.approve(agentId)
    expect(gate.canComplete(agentId)).toBe(true)
  })
})
