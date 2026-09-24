/** Layer 2 — Progress ledger instruction for goal rounds. */

/**
 * Render the progress ledger instruction injected via steer at the start
 * of each goal round. Equivalent to dlPFC maintaining the active goal
 * representation with explicit evidence tracking.
 * @param objective - the goal's textual objective.
 * @param round - current round number.
 * @param maxRounds - total round cap.
 * @returns steering text content.
 */
export function renderLedgerInstruction(
  objective: string,
  round: number,
  maxRounds: number,
): string {
  return (
    '<progress_ledger>\n'
    + `Round ${round}/${maxRounds} — Objective: ${JSON.stringify(objective)}\n\n`
    + 'Before taking any action this round, update your progress ledger:\n'
    + '- For each completed sub-task: cite the exact tool result or command output '
    + '(exit code, diff output, test result) that proves it.\n'
    + '- For each pending sub-task: state the next concrete action.\n'
    + '- Do NOT mark anything verified unless a tool result in this session '
    + 'confirms it. Code inspection alone is not verification.\n'
    + '- If your ledger shows all items verified with real evidence, and only then, '
    + 'you may call get_goal and update_goal to mark complete.\n'
    + '</progress_ledger>\n'
  )
}
