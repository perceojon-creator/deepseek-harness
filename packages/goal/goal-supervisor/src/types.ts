/** Pure types for the goal supervisor — no runtime code. */

/** Supervisor's evaluation of the agent's current state. */
export type SupervisorAction = 'approve' | 'redirect'

/** Result of one supervisor evaluation. */
export interface SupervisorVerdict {
  /** Whether to allow the turn to close or redirect the model. */
  readonly action: SupervisorAction
  /** Specific critique when action is 'redirect'. */
  readonly critique?: string
  /** Layer that originated this verdict (3 = deterministic, 4 = LLM). */
  readonly layer: 3 | 4
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
