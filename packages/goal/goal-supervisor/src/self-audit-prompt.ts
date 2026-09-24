/** Layer 1 — Metacognitive self-audit prompt section. */

/**
 * Render the self-audit system prompt section injected when a goal is active.
 * This embeds metacognitive obligations into the model's own reasoning rather
 * than relying on an external evaluator — equivalent to the phonological loop
 * of working memory continuously rehearsing the objective.
 * @param objective - the active goal's textual objective.
 * @returns the system prompt text to register.
 */
export function renderSelfAuditSection(objective: string): string {
  return (
    'A metacognitive supervisor monitors this session. You cannot abandon '
    + 'the current objective until it is fully and verifiably complete.\n\n'
    + `Active objective: ${JSON.stringify(objective)}\n\n`
    + 'Before ending any turn or claiming completion, you MUST emit a '
    + '<self_audit> block in your reasoning that contains:\n'
    + '1. A progress ledger listing every sub-task as verified (with the tool '
    + 'call or command that proved it) or pending (with the next concrete action).\n'
    + '2. An honest assessment: have you run real verification commands (compile, '
    + 'test, diff) whose output confirms functional equivalence, or are you '
    + 'assuming success from code inspection alone?\n'
    + '3. If any item is pending or unverified, you must not attempt to close '
    + 'the turn — continue working on the next pending item.\n'
    + '4. You must not abandon the objective, declare premature completion, or '
    + 'write trivial tests that mirror the implementation without exercising '
    + 'real behavior. Every test must execute real code and compare real output.\n'
    + '</self_audit>\n'
  )
}
