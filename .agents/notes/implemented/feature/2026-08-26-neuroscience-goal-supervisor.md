# Agent Note: Neuroscience-aligned metacognitive goal supervisor

Status: implemented

English | [中文](2026-08-26-neuroscience-goal-supervisor.zh.md)

## Problem

Fast inference ("flash") models exhibit acute failure modes when pursuing long-running goals across autonomous continuation rounds: they lack deep, sustained chain-of-thought planning, drift away from high-level objectives as context accumulates, and prematurely declare victory by fabricating trivial or tautological tests without running empirical functional validation.

Previous goal architecture left completion verification deferred: `dsh-tool-goal` accepted `update_goal(complete)` based solely on the model's self-certification. The model acted as both executor and judge. An external evaluator operating as an isolated secondary agent would break the conversational workspace, while inserting criticism as an external user role creates compliance theater rather than genuine internal metacognitive regulation.

## Decision

`@deepseek-ai/dsh-goal-supervisor` in `packages/goal/goal-supervisor/` implements a five-layer metacognitive supervisor inspired by the anterior cingulate cortex (ACC) and dorsolateral prefrontal cortex (dlPFC) executive control circuits:

1. **Layer 1 — Metacognitive self-audit prompt section (`supervisor:self-audit`):** Dynamically registered at `FIRST_PARTY_SECTION_ORDER.TOOL_GOAL + 10` when a goal is active. Mandates that the model emit a structured `<self_audit>` block before concluding any turn or claiming completion.
2. **Layer 2 — Progress ledger enrichment:** Intercepts `agent/pre-step` when a goal round is admitted and prepends a `<progress_ledger>` requirement demanding verified tool output citations for every sub-task.
3. **Layer 3 — Deterministic evasion detector:** Pure heuristic analysis of session events without LLM overhead. Detects `NO_VERIFICATION` (mutation calls without compilation or test execution), `PREMATURE_COMPLETE`, and `INSUFFICIENT_WORK`.
4. **Layer 4 — Cascading LLM supervisor call:** When Layer 3 fires or the agent attempts to conclude a turn with an active goal, evaluates the recent session context and reasoning blocks. Cascades from configured provider/model (Anthropic Claude Sonnet 4.5 by default) to the session's active model. Fails closed (redirect on evaluation error).
5. **Layer 5 — Basal ganglia completion gate:** Intercepts `agent/turn-stopping` to steer with critique notices (`agent.steer`) when the supervisor redirects, preventing turn closure. Blocks `update_goal(complete)` via `tools/post-execute` until the supervisor explicitly approves the turn.

## Testing

Unit and composition coverage verify all five layers: scaffold exports and configuration schemas, dynamic system prompt section injection on goal creation, progress ledger prepending on admitted goal rounds, deterministic evasion detection heuristics, LLM supervisor prompt assembly and fail-closed verdict parsing, turn-stopping redirection and completion gate blocking/approval. Full test suite in `packages/goal/` executes 164 passing tests across 16 test files.

## Alternatives considered

- **Two-agent worker/reviewer barrier** — rejected because it isolates context into fragmented subagents, increases latency and token duplication, and destroys the unified conversational workspace.
- **External user-role critique injection** — rejected because an external voice creates compliance behavior rather than self-regulatory metacognition.
- **Purely deterministic verification gates** — rejected because mechanical checks alone cannot evaluate nuanced, non-binary completion criteria.

## Consequences

- Flash models cannot prematurely complete goals or close rounds without empirical verification.
- Completion authority is stripped from model self-assessment and gated by the supervisor.
- Metacognitive regulation operates continuously within the same session history without extra subagent overhead.
- Model selection cascades seamlessly from dedicated high-reasoning models to session defaults.

## Known limitations and deferred work

- Requires a live LLM adapter when Layer 4 is invoked.
- Multi-repo cross-boundary verification pipelines remain an application responsibility.
