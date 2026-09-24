/** Layer 5 — Completion gate: basal ganglia go/no-go circuit. */

/**
 * Process-local gate tracking whether the supervisor has certified the
 * current turn for goal completion. Per-agent, per-turn scope.
 */
export class CompletionGate {
  private approved = new Map<string, boolean>()

  /**
   * Mark that the supervisor approved completion for this agent's current turn.
   * @param agentId - The agent ID to grant completion permission to.
   */
  approve(agentId: string): void {
    this.approved.set(agentId, true)
  }

  /**
   * Check whether the supervisor has approved.
   * @param agentId - The agent ID to inspect for completion approval.
   * @returns true if the agent is certified to complete in the current turn.
   */
  canComplete(agentId: string): boolean {
    return this.approved.get(agentId) === true
  }

  /**
   * Reset approval at each new turn start.
   * @param agentId - The agent ID whose turn-level approval is revoked.
   */
  resetTurn(agentId: string): void {
    this.approved.delete(agentId)
  }

  /**
   * Clean up when an agent is disposed.
   * @param agentId - The agent ID to purge from the gate.
   */
  dispose(agentId: string): void {
    this.approved.delete(agentId)
  }
}
