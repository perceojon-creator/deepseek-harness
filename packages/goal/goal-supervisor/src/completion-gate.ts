/** Layer 5 — Completion gate: basal ganglia go/no-go circuit. */

/**
 * Process-local gate tracking whether the supervisor has certified the
 * current turn for goal completion. Per-agent, per-turn scope.
 */
export class CompletionGate {
  private approved = new Map<string, boolean>()

  /** Mark that the supervisor approved completion for this agent's current turn. */
  approve(agentId: string): void {
    this.approved.set(agentId, true)
  }

  /** Check whether the supervisor has approved. */
  canComplete(agentId: string): boolean {
    return this.approved.get(agentId) === true
  }

  /** Reset approval at each new turn start. */
  resetTurn(agentId: string): void {
    this.approved.delete(agentId)
  }

  /** Clean up when an agent is disposed. */
  dispose(agentId: string): void {
    this.approved.delete(agentId)
  }
}
