/** Layer 1 — Metacognitive self-audit prompt section. */

/**
 * Render the self-audit system prompt section injected when a goal is active.
 * The section restates the objective each request and asks the model to keep
 * an evidence-backed progress ledger in its own reasoning.
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
    + '5. update_goal completion is denied while a code change has no successful '
    + 'recognized verification command after it, and the supervisor may also deny it with a '
    + 'critique. Treat each verified sub-task as progress, not completion itself as the reward.\n'
    + '</self_audit>\n'
  )
}
