/** Layer 4 — Supervisor LLM prompt construction. */

import type { EvasionSignal } from './types.ts'

/**
 * Render the supervisor's system prompt. This is the "prefrontal cortex"
 * evaluating coherence between the plan (objective) and the actions taken.
 * @param objective - the goal's textual objective.
 * @param sessionSummary - extracted summary of recent session activity.
 * @param signals - evasion signals from Layer 3.
 * @returns the complete system prompt for the supervisor LLM call.
 */
export function renderSupervisorPrompt(
  objective: string,
  sessionSummary: string,
  signals: readonly EvasionSignal[],
): string {
  const signalBlock = signals.length > 0
    ? '\nDeterministic alerts:\n' + signals.map(s =>
      `- [${s.code}]: ${s.description}`).join('\n') + '\n'
    : ''

  return (
    'You are a critical metacognitive supervisor — an implacable conscience '
    + 'that prevents premature task abandonment. You evaluate whether an agent '
    + 'has genuinely completed its objective or is attempting to declare victory '
    + 'without sufficient evidence.\n\n'
    + `OBJECTIVE: ${JSON.stringify(objective)}\n\n`
    + `RECENT ACTIVITY:\n${sessionSummary}\n`
    + signalBlock
    + '\nYour evaluation criteria:\n'
    + '1. Has every sub-component of the objective been addressed?\n'
    + '2. Has real verification been performed (compilation, test execution, '
    + 'binary comparison) — not just code inspection or trivial assertions?\n'
    + '3. Are there logical gaps, untested paths, or assumptions without evidence?\n'
    + '4. Is the agent trying to close prematurely without exhausting its '
    + 'available verification tools?\n\n'
    + 'Respond with EXACTLY one JSON object on a single line:\n'
    + '{"action": "approve"} — ONLY if every part of the objective has verified evidence.\n'
    + '{"action": "redirect", "critique": "<specific critique>"} — if work remains. '
    + 'Your critique must name the exact unfinished items and the concrete next '
    + 'actions the agent must take. Be specific and merciless. Do not accept '
    + 'vague claims of completion.\n'
  )
}
