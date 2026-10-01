# Agent Note: Goal supervisor completion review

Status: implemented

English | [中文](2026-08-26-neuroscience-goal-supervisor.zh.md)

## Problem

The goal tool accepts a model-facing request to complete an active goal. A model can report progress without running a meaningful check, so completion review needs recorded tool results and an independent evaluator decision.

## Decision

`@deepseek-ai/dsh-goal-supervisor` combines model instructions, event heuristics, an LLM evaluator, episodic summaries, and a model-facing completion check. Neuroscience terms in module names are inspiration only: each layer is a prompt, a regex or event-pattern heuristic, or a model call.

1. **Self-audit and progress ledger:** `supervisor:self-audit` and admitted-round ledger messages ask the model to report sub-tasks and evidence. They are prompt instructions; the package does not parse or enforce the requested blocks.
2. **Event heuristics:** `detectEvasion`, `PerseverationTracker`, `IntentionTracker`, and `analyzeReasoningQuality` inspect the current turn's reasoning text, tool arguments, and paired tool results. Verification recognizes `bash` and `pwsh` commands that run known test, build, typecheck, or lint programs; each recognized verification call must have a result that is not an error and does not end with a failing exit, signal, or timeout marker. Intention drift matches first-person commitment phrases and ignores a commitment negated in its own clause; the hedging check counts phrases. These checks do not determine whether a command adequately tests the goal.
3. **Supervisor evaluation:** `agent/turn-stopping` evaluates the current turn for each active goal, and `tools/pre-execute` evaluates a completion request once every recorded code change has a successful verification after it. The evaluator receives recorded tool calls, result text, and assistant reasoning within a configured character limit. `goal-supervisor/llm-request` and `goal-supervisor/llm-result` record the complete auxiliary request and response without adding them to derived conversation history. It uses the configured provider/model when both are valid, otherwise the active agent provider/model. A failed, timed-out, cancelled, or unparseable evaluation is `abstain`, never `redirect`. Each request carries the caller's turn or tool-call signal fused with a `supervisorTimeoutMs` timeout.
4. **Episodic consolidation:** The manager combines the prior summary with activity since the previous successful consolidation. It holds the summary in process memory, so it survives context compaction but is rebuilt from session events at the next configured interval after process restart.
5. **Completion check:** `tools/pre-execute` checks the current active goal ID and revision, requires successful recognized verification in that turn, and asks the evaluator to review the request before allowing model-facing `update_goal(complete)`. `redirect` denies; `abstain` allows with a logged warning (fail-open) because the deterministic verification requirement already holds, unless the call was cancelled. No approval is cached, so an approval cannot outlive its turn or revision. The check does not intercept direct calls to the goal service.
6. **Bounded steering:** At turn stop the supervisor steers on `redirect`, or when the turn called a configured code-change tool or attempted completion without successful verification. Turns without either, such as research or documentation turns, are not steered for missing verification. At most `maxConsecutiveRedirects` (default 3) steers occur per goal revision per turn; once spent, the supervisor logs a warning, skips the evaluator, and lets the turn end, and the goal round cap bounds further rounds.
7. **Scoped state:** Prompt sections render for the agent in the assembly context. Salience, consolidation, and steer-budget state is keyed by agent and bound to one goal ID and revision; approval clears salience, and agent disposal drops all state.

## Testing

Unit tests cover the heuristics, verdict parsing, and consolidation retry. Composition tests load the plugin with the goal, tool, and system-prompt services and drive turns through its listeners: denied completion leaves `goal.phase` active, the steer budget stops after N steers, evaluator failure and unparseable output do not steer, a timed-out request aborts, repeated non-zero `bash` exits across three turns produce `PERSEVERATION`, a negated commitment produces no `INTENTION_DRIFT`, and salience from a redirect appears in the next round ledger.

## Alternatives considered

- **Separate worker and reviewer agents** — rejected because they split the active conversation context and add model calls.
- **Critique as a synthetic user message** — rejected because an external message changes the conversation instead of gating the completion tool.
- **Command output as proof of semantic correctness** — rejected because successful process exit does not establish that checks cover the goal.

## Consequences

- Completion through the model-facing goal tool requires a successful recognized verification after the last recorded code change (none is needed when no code changed) and no evaluator `redirect` for that request.
- Prompt instructions and command recognition remain heuristic; neither guarantees semantic completeness.
- The evaluator runs at every turn stop with an active goal until the steer budget is spent, adding an LLM round trip bounded by `supervisorTimeoutMs`.
- An unavailable evaluator does not block verified completion.
- Episodic summaries are process-local and are reconstructed after restart from durable session events.

## Known limitations and deferred work

- Cross-repository verification commands and goal-specific validation remain application responsibilities.
- The completion check covers `update_goal` tool execution, not direct goal-service callers.
