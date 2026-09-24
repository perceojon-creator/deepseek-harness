import { describe, expect, it, vi } from 'vitest'
import { GoalId } from '@deepseek-ai/dsh-goal'
import type { GoalView } from '@deepseek-ai/dsh-goal'
import { CompletionGate } from '../src/completion-gate.ts'

describe('Turn stopping and completion gate interactions', () => {
  const _goal: GoalView = {
    id: GoalId('g1'),
    revision: 1,
    objective: 'Port C++ to Rust',
    phase: 'active',
    maxGoalRounds: 50,
    roundsStarted: 2,
    createdAt: 0,
    updatedAt: 0,
    activation: 'armed',
  }

  it('steers the agent when supervisor redirects at turn-stopping', async () => {
    const steeredMessages: unknown[] = []
    const fakeAgent = {
      id: 'agent-test',
      steer: vi.fn((msg: unknown) => {
        steeredMessages.push(msg)
      }),
      session: {
        events: [
          { type: 'turn/start', seq: 1 },
          { type: 'tool/execute', seq: 2, data: { name: 'write', arguments: {} } },
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
    expect(steeredMessages[0]).toMatchObject({
      content: [{ text: expect.stringContaining('cargo test') }],
    })
    expect(gate.canComplete(fakeAgent.id)).toBe(false)
  })

  it('approves the completion gate when supervisor approves at turn-stopping', () => {
    const gate = new CompletionGate()
    const agentId = 'agent-test-2'

    expect(gate.canComplete(agentId)).toBe(false)
    gate.approve(agentId)
    expect(gate.canComplete(agentId)).toBe(true)
  })
})
