import { describe, expect, it } from 'vitest'
import { renderSelfAuditSection } from '../src/self-audit-prompt.ts'

describe('renderSelfAuditSection', () => {
  it('contains the structured self-audit block tags', () => {
    const text = renderSelfAuditSection('Migrate parser.cpp to Rust')
    expect(text).toContain('<self_audit>')
    expect(text).toContain('</self_audit>')
    expect(text).toContain('Migrate parser.cpp to Rust')
  })

  it('requires progress ledger before any completion claim', () => {
    const text = renderSelfAuditSection('Port 1M lines C++ to Rust')
    expect(text).toContain('progress ledger')
    expect(text).toContain('verified')
    expect(text).toContain('pending')
  })

  it('prohibits abandoning the objective', () => {
    const text = renderSelfAuditSection('any objective')
    expect(text).toMatch(/cannot abandon|must not abandon|do not abandon/i)
  })

  it('frames sustained work as the desired outcome, not completion', () => {
    const text = renderSelfAuditSection('Port C++ to Rust')
    expect(text).toMatch(/productive work.*correct outcome|each.*verified.*progress/i)
    expect(text).toMatch(/reverted|rejected|failure/i)
  })
})
