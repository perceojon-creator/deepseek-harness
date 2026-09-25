---
description: "Neuroscience-aligned metacognitive goal supervisor with five-layer verification."
kind: "package-reference"
---

# @deepseek-ai/dsh-goal-supervisor

English | [中文](README.zh.md)

## Summary

`dsh-goal-supervisor` provides a five-layer metacognitive supervisor that prevents premature goal completion, especially by fast/flash models, using an architecture modeled on the ACC and dlPFC prefrontal cortex. The supervisor inspects working memory prompts, progress ledgers, deterministic evasion patterns, supervisory LLM critiques, and an authoritative completion gate before allowing any goal to conclude. Mount it alongside `dsh-goal-round-driver` when autonomous goal pursuit requires rigorous empirical verification rather than passive self-reports.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount `dsh-goal-supervisor` in your Cordis profile alongside `dsh-goal` and `dsh-goal-round-driver`. It activates automatically whenever an agent has an active goal.

### Configure it

```yaml
- id: goal-supervisor
  name: '@deepseek-ai/dsh-goal-supervisor'
  config:
    supervisorProvider: deepseek
    supervisorModel: deepseek-chat
```

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-goal-supervisor) is the exhaustive source for every accepted field.

### Five-layer verification architecture

| Layer | Anatomical equivalent | Mechanism |
|---|---|---|
| 1. Self-audit prompt | Phonological loop / working memory | Dynamic `<self_audit>` section in system prompt |
| 2. Progress ledger | dlPFC executive control | `<progress_ledger>` instructions on admitted rounds |
| 3. Evasion detector | Anterior Cingulate Cortex (ACC) | Deterministic conflict signal detection (`NO_VERIFICATION`, `PREMATURE_COMPLETE`) |
| 4. Supervisory critique | Deep reasoning / metacognitive judge | LLM evaluation call with fail-closed verdict parsing |
| 5. Completion gate | Basal ganglia go/no-go circuit | Execution interceptor blocking `update_goal(complete)` until approved |

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains how the supervisor coordinates prompt enrichment, deterministic evasion heuristics, and completion gating.

### Design

- **Fail-closed completion gate.** Calls to `update_goal` with action `complete` are intercepted via `tools/post-execute`. If the gate has not approved completion for the agent's current turn, the call is blocked and redirected with diagnostic feedback.
- **Deterministic evasion heuristics.** Before invoking LLM supervision, `detectEvasion` analyzes turn events for unverified closures or premature completions with zero LLM overhead.
- **Cascading model resolution.** `resolveSupervisorModel` attempts to use the configured supervisor model and provider, falling back to the active agent provider and model when unconfigured.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry, config schema, lifecycle hook wiring |
| [`src/completion-gate.ts`](src/completion-gate.ts) | Basal ganglia go/no-go completion gate tracking approvals per turn |
| [`src/evasion-detector.ts`](src/evasion-detector.ts) | Deterministic evasion pattern detector without LLM cost |
| [`src/perseveration-detector.ts`](src/perseveration-detector.ts) | OFC perseveration detector tracking repeated failure patterns across turns |
| [`src/intention-tracker.ts`](src/intention-tracker.ts) | VTA intention drift detector comparing declared plans against executed tools |
| [`src/forward-model-analyzer.ts`](src/forward-model-analyzer.ts) | Cerebellar forward-model reasoning quality and hedging analyzer |
| [`src/episodic-consolidation.ts`](src/episodic-consolidation.ts) | Hippocampal episodic memory consolidation manager for long-running goals |
| [`src/self-audit-prompt.ts`](src/self-audit-prompt.ts) | Metacognitive self-audit system prompt section renderer |
| [`src/round-prompt-enrichment.ts`](src/round-prompt-enrichment.ts) | Progress ledger instructions renderer for admitted rounds |
| [`src/supervisor-prompt.ts`](src/supervisor-prompt.ts) | Metacognitive critique prompt renderer for the supervisor LLM |
| [`src/supervisor-call.ts`](src/supervisor-call.ts) | Supervisory LLM invocation, streaming, and verdict parser |
| [`src/invariant.ts`](src/invariant.ts) | Runtime invariant companion |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Goal service](../goal/README.md) — the persistent goal domain and lifecycle state.
- [Goal tools](../tool-goal/README.md) — the model-facing tools for inspecting and updating goals.
- [Goal round driver](../goal-round-driver/README.md) — the autonomous continuation driver.

-----

<a id="model-experience"></a>
## Model Experience

### System prompt

#### What the model sees

A dynamic self-audit section is contributed to the system prompt whenever a goal is active on a root agent, instructing the model to maintain an internal progress ledger and refrain from premature completion.

##### Self-audit instruction

```markdown
A metacognitive supervisor monitors this session. You cannot abandon the current objective until it is fully and verifiably complete.

Active objective: "Example objective"

Before ending any turn or claiming completion, you MUST emit a <self_audit> block in your reasoning that contains:
1. A progress ledger listing every sub-task as verified (with the tool call or command that proved it) or pending (with the next concrete action).
2. An honest assessment: have you run real verification commands (compile, test, diff) whose output confirms functional equivalence, or are you assuming success from code inspection alone?
3. If any item is pending or unverified, you must not attempt to close the turn — continue working on the next pending item.
4. You must not abandon the objective, declare premature completion, or write trivial tests that mirror the implementation without exercising real behavior. Every test must execute real code and compare real output.
</self_audit>
```

#### Token effect

Small dynamic input cost on every request where an active goal is present.

#### KV Cache effect

Prefix-stable while the objective text is unchanged. Changing the active goal modifies the rendered section and invalidates subsequent cache entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Evaluator LLM latency** — Layer 4 involves an LLM evaluation call on turn stopping when evasion signals are detected, adding round-trip latency to evasive turns.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers; it is explicitly non-authoritative. The five-layer architecture maps directly to cognitive neuroscience models of executive control and conflict monitoring.

</details>
