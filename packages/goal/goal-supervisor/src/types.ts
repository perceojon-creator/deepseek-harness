/** Pure types for the goal supervisor — no runtime code. */

/**
 * Supervisor's evaluation of the agent's current state. `abstain` records that
 * no usable evaluation exists (the model call failed, was cancelled or timed
 * out, or its response was not a parseable verdict); callers treat it as
 * neither approval nor redirect.
 */
export type SupervisorAction = 'approve' | 'redirect' | 'abstain'

/** One sub-task with its risk/priority ranking from the supervisor. */
export interface SalienceEntry {
  /** Short sub-task description. */
  readonly task: string
  /** Risk level assigned by the supervisor. */
  readonly risk: 'critical' | 'high' | 'medium' | 'low'
}

/** Result of one supervisor evaluation; the evaluator model is layer 4. */
export type SupervisorVerdict =
  | {
    readonly action: 'approve'
    readonly layer: 4
  }
  | {
    readonly action: 'redirect'
    /** Unfinished items and next actions, delivered to the agent. */
    readonly critique: string
    readonly layer: 4
    /** Optional risk-ranked remaining tasks. */
    readonly salience?: readonly SalienceEntry[]
  }
  | {
    readonly action: 'abstain'
    /** Why no evaluation is available. */
    readonly reason: string
    readonly layer: 4
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
