import { describe, expect, it } from 'vitest'
import { renderSupervisorPrompt } from '../src/supervisor-prompt.ts'

describe('renderSupervisorPrompt', () => {
  it('frames the supervisor as a critical metacognitive conscience', () => {
    const prompt = renderSupervisorPrompt(
      'Port 1M lines C++ to Rust',
      'The agent wrote 3 files and ran no tests.',
      [{ code: 'NO_VERIFICATION', description: '5 writes, 0 verification' }],
    )
    expect(prompt).toContain('critical metacognitive supervisor')
    expect(prompt).toContain('approve')
    expect(prompt).toContain('redirect')
    expect(prompt).toContain('Port 1M lines C++ to Rust')
    expect(prompt).toContain('NO_VERIFICATION')
  })

  it('requires structured single-line JSON output', () => {
    const prompt = renderSupervisorPrompt('any', 'any', [])
    expect(prompt).toContain('{"action": "approve"}')
    expect(prompt).toContain('{"action": "redirect"')
  })
})
