---
description: "Metacognitive goal supervisor: prompt sections, recorded-evidence heuristics, an evaluator model, and a completion check."
kind: "package-reference"
---

# @deepseek-ai/dsh-goal-supervisor

English | [中文](README.zh.md)

## Summary

`dsh-goal-supervisor` combines prompt sections, pattern checks over recorded session events, an evaluator model call, a periodic model-written summary, and a pre-execution check on model-facing goal completion calls. Layer names borrow neuroscience terms as inspiration only: each layer is a prompt, a regex or event-pattern heuristic, or a model call, and none models a brain region. Mount it with `dsh-goal` and `dsh-goal-round-driver` when autonomous goal pursuit needs completion review.

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

Mount `dsh-goal-supervisor` in your Cordis profile alongside `dsh-goal` and `dsh-goal-round-driver`. It acts on each agent that has its own active goal.

### Configure it

```yaml
- id: goal-supervisor
  name: '@deepseek-ai/dsh-goal-supervisor'
  config:
    consolidationInterval: 5
    sessionSummaryMaxChars: 12000
    supervisorTimeoutMs: 60000
    maxConsecutiveRedirects: 3
    codeChangeTools: [write, edit, str_replace_editor]
```

Unless `supervisorProvider` and `supervisorModel` are both set, evaluator calls use the active agent provider and model. Verification detection is heuristic: a `bash` or `pwsh` call whose `command` runs a recognized test, build, typecheck, or lint program counts when its recorded result is not an error and does not end with a failing exit, signal, or timeout marker. It does not establish that a command meaningfully tests the goal.

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-goal-supervisor) is the exhaustive source for every accepted field.

### Turn-stop steering

At each `agent/turn-stopping` of an agent with an active goal, the supervisor collects the layer 3 signals, calls the evaluator, and steers the agent with one critique message when the evaluator returns `redirect`, or when the turn called a `codeChangeTools` tool and recorded no successful recognized verification result after the last such call. A turn that changed no code, such as research or documentation work, is not steered for missing verification. At most `maxConsecutiveRedirects` steers occur in one turn of one goal revision; after that the supervisor logs a warning, skips the evaluator, and lets the turn end. An evaluator call that fails, times out, is cancelled, or returns no recognized JSON verdict yields `abstain`, which neither steers nor denies.

<a id="completion-check"></a>
### Completion check

The `tools/pre-execute` listener denies `update_goal(complete)` unless the request names the active goal and revision and the session's last `codeChangeTools` call, if any, is followed by a successful recognized verification result. A goal that changed no code is judged by the evaluator alone. The evaluator then reviews the turn: `redirect` denies with its critique, `approve` allows, and `abstain` allows with a logged warning because every recorded code change is already verified; a cancelled call is denied. Every evaluator and consolidation request is aborted after `supervisorTimeoutMs` or when the requesting turn or tool call is cancelled, so the check cannot wait indefinitely. Nothing is cached between calls: each completion request is evaluated against its own turn.

### Layers

| Layer | Inspiration | What it does |
|---|---|---|
| 1. Self-audit prompt | Working-memory rehearsal | System-prompt section, for the agent whose prompt is assembled, that restates the objective, asks for an evidence-backed ledger, and forbids tests that mirror the implementation |
| 2. Progress ledger | Prefrontal goal maintenance; insular salience | Notice prepended to each admitted goal round, with the latest redirect's risk-ranked task list for the same goal revision |
| 3a. Evasion checks | Anterior cingulate conflict monitoring | `NO_VERIFICATION`, `PREMATURE_COMPLETE`, and `INSUFFICIENT_WORK` signals computed from recorded tool calls and results |
| 3b. Perseveration check | Orbitofrontal response inhibition | `PERSEVERATION` when the same failed-result signature (tool, failure code, output prefix) recurs in three consecutive turns; non-zero exit markers count as failures |
| 3c. Intention drift | Reward prediction error, by name only | `INTENTION_DRIFT` when reasoning contains a non-negated commitment such as "I will run the tests" or "let me compile" and the turn records no successful verification |
| 3d. Hedging phrases | Cerebellar forward model, by name only | `WEAK_REASONING` when reasoning in a turn without successful verification matches two or more hedging or verification-avoidance phrases; a phrase count, not a predictive model |
| 4. Evaluator | Metacognitive judgment | One model call per turn stop and per completion request that passed the verification check, returning `approve`, `redirect` with optional salience, or `abstain` |
| 4.5. Episodic consolidation | Hippocampal consolidation | Every `consolidationInterval` rounds, a model-written summary shown as quoted untrusted data in the same agent's system prompt for the same goal revision |
| 5. Completion check | Basal ganglia go/no-go | The `tools/pre-execute` denial described in [Completion check](#completion-check) |

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains how the supervisor reads recorded evidence, calls the evaluator, and scopes its per-agent state.

### Design

- **Model-facing completion review.** The completion check runs in `tools/pre-execute`, before the `update_goal` body. Direct calls to the goal service do not pass through this tool check.
- **Recorded evidence.** Layer 3 reads calls, results, and reasoning only from the current turn's session events, including `bash` and `pwsh` calls made through PTC once their sub-dispatch results are recorded. A completion request inside the same `run_code` call is denied because PTC records those results when that call settles.
- **Scoped state.** Prompt sections read the agent from the assembly context. Salience lists, consolidation summaries, and the steer budget are keyed by agent and bound to one goal ID and revision; a goal edit or a new goal starts empty, approval clears the salience list, and agent disposal drops all of them. Perseveration counts a steered turn once, using its latest stop.
- **Logged evaluator calls.** Each evaluator and consolidation request records its complete system prompt, provider, model, options, and user text; a paired event records the raw response or failure status. These log-only events do not enter the agent's derived conversation history.
- **Cascading model resolution.** `resolveSupervisorModel` uses the configured provider and model when both are valid; otherwise it uses the active agent provider and model.
- **Process-local consolidation.** The summary survives context compaction in the current process. After process restart, consolidation rebuilds from session events at the next configured interval.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry, config schema, steering budget, completion check, lifecycle listeners |
| [`src/recorded-activity.ts`](src/recorded-activity.ts) | Recorded calls, outcomes, failure markers, and reasoning read from session events |
| [`src/evasion-detector.ts`](src/evasion-detector.ts) | Recognized verification commands and the layer 3a signals |
| [`src/perseveration-detector.ts`](src/perseveration-detector.ts) | Failed-result signatures and the consecutive-turn counter |
| [`src/intention-tracker.ts`](src/intention-tracker.ts) | Verification-commitment patterns with clause negation |
| [`src/forward-model-analyzer.ts`](src/forward-model-analyzer.ts) | Hedging-phrase counter |
| [`src/episodic-consolidation.ts`](src/episodic-consolidation.ts) | Process-local incremental summary manager |
| [`src/self-audit-prompt.ts`](src/self-audit-prompt.ts) | Self-audit system-prompt section renderer |
| [`src/round-prompt-enrichment.ts`](src/round-prompt-enrichment.ts) | Progress ledger renderer for admitted rounds |
| [`src/supervisor-prompt.ts`](src/supervisor-prompt.ts) | Evaluator system-prompt renderer |
| [`src/supervisor-call.ts`](src/supervisor-call.ts) | Evaluator request, timeout signal, logging, and verdict parser |
| [`src/session-events.ts`](src/session-events.ts) | Durable log-only event types for auxiliary supervisor model requests and results |
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

An agent whose own goal is active sees the self-audit section in its system prompt. Each admitted goal round also starts with a `<progress_ledger>` notice, and a steered turn receives a notice that begins `[Metacognitive Supervisor]:` followed by the evaluator critique or the missing-verification instruction.

##### Self-audit instruction

```markdown
A metacognitive supervisor monitors this session. You cannot abandon the current objective until it is fully and verifiably complete.

Active objective: "Example objective"

Before ending any turn or claiming completion, you MUST emit a <self_audit> block in your reasoning that contains:
1. A progress ledger listing every sub-task as verified (with the tool call or command that proved it) or pending (with the next concrete action).
2. An honest assessment: have you run real verification commands (compile, test, diff) whose output confirms functional equivalence, or are you assuming success from code inspection alone?
3. If any item is pending or unverified, you must not attempt to close the turn — continue working on the next pending item.
4. You must not abandon the objective, declare premature completion, or write trivial tests that mirror the implementation without exercising real behavior. Every test must execute real code and compare real output.
5. update_goal completion is denied while a code change has no successful recognized verification command after it, and the supervisor may also deny it with a critique. Treat each verified sub-task as progress, not completion itself as the reward.
</self_audit>
```

#### Token effect

Small dynamic input cost on every request where an active goal is present.

#### KV Cache effect

Prefix-stable while the objective text is unchanged. Changing the active goal modifies the rendered section and invalidates subsequent cache entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Evaluator LLM latency** — Layer 4 calls the evaluator at each turn stop with an active goal, until the steer budget is spent, and before each completion request that passed the verification check.
- **Heuristic verification** — A recognized command with a successful tool result is treated as verification evidence; the package does not judge whether the command adequately validates the objective. File changes made through shell commands do not count as `codeChangeTools` calls.
- **English phrase heuristics** — Intention-drift and hedging patterns match English phrases; negation handling inspects only the clause before a commitment.
- **Fail-open on evaluator abstention** — When the evaluator is unavailable, verified completion is allowed and the turn is steered only for missing verification after code changes.
- **Model-facing scope** — The completion check intercepts `update_goal` tool execution. Code calling the goal service directly is outside this check.
- **Consolidation durability** — Episodic summaries are held in process memory and rebuilt from session events after restart at the next consolidation interval.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers; it is explicitly non-authoritative. The neuroscience names orient readers to the intent of each layer; they are not claims that the heuristics reproduce those mechanisms.

</details>
