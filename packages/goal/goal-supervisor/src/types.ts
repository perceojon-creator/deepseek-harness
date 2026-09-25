/** Pure types for the goal supervisor — no runtime code. */

/** Supervisor's evaluation of the agent's current state. */
export type SupervisorAction = 'approve' | 'redirect'

/** One sub-task with its risk/priority ranking from the supervisor. */
export interface SalienceEntry {
  /** Short sub-task description. */
  readonly task: string
  /** Risk level assigned by the supervisor. */
  readonly risk: 'critical' | 'high' | 'medium' | 'low'
}

/** Result of one supervisor evaluation. */
export interface SupervisorVerdict {
  /** Whether to allow the turn to close or redirect the model. */
  readonly action: SupervisorAction
  /** Specific critique when action is 'redirect'. */
  readonly critique?: string
  /** Layer that originated this verdict (3 = deterministic, 4 = LLM). */
  readonly layer: 3 | 4
  /** Optional risk-ranked salience map from the supervisor. */
  readonly salience?: readonly SalienceEntry[]
}

/** Evasion signal detected by Layer 3 deterministic analysis. */
export interface EvasionSignal {
  /** Machine-routable signal code. */
  readonly code: string
  /** Human-readable explanation. */
  readonly description: string
}

/** Hashed identity of the error pattern in one turn, for perseveration detection. */
export type TurnErrorSignature = string & { readonly __turnErrorSignature: true }
