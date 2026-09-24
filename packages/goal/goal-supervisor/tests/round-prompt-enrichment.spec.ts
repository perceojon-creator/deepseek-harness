import { describe, expect, it } from 'vitest'
import { renderLedgerInstruction } from '../src/round-prompt-enrichment.ts'

describe('renderLedgerInstruction', () => {
  it('demands an explicit progress ledger update', () => {
    const text = renderLedgerInstruction('Port C++ to Rust', 3, 50)
    expect(text).toContain('<progress_ledger>')
    expect(text).toContain('</progress_ledger>')
    expect(text).toContain('Round 3/50')
  })

  it('requires concrete verification evidence for each item', () => {
    const text = renderLedgerInstruction('any', 1, 10)
    expect(text).toMatch(/exit code|command output|tool result/i)
  })
})
