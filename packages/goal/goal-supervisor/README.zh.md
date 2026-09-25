---
description: "具备五层验证、与神经科学对齐的元认知目标监督器。"
kind: "package-reference"
---

# @deepseek-ai/dsh-goal-supervisor

[English](README.md) | 中文

## 概述

`dsh-goal-supervisor` 提供了一个五层元认知监督器，采用基于前扣带皮层（ACC）和背外侧前额叶皮层（dlPFC）建模的架构，防止模型（特别是 fast/flash 模型）过早将目标标记为完成。在允许任何目标完成之前，该监督器会依序检查工作记忆提示词、进度账本、确定性规避模式、监督 LLM 批判意见以及权威的完成门禁。当自主目标追求需要严格的实证检验而非消极自我报告时，请将其与 `dsh-goal-round-driver` 协同挂载。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

在 Cordis 配置文件中将 `dsh-goal-supervisor` 与 `dsh-goal` 及 `dsh-goal-round-driver` 一同挂载。只要 Agent 拥有处于活跃状态的目标，它便会自动激活。

### 配置

```yaml
- id: goal-supervisor
  name: '@deepseek-ai/dsh-goal-supervisor'
  config:
    supervisorProvider: deepseek
    supervisorModel: deepseek-chat
```

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-goal-supervisor)是所有受支持字段的权威来源。

### 五层验证架构

| 层级 | 解剖学对应 | 机制 |
|---|---|---|
| 1. 自审提示词 | 语音回路 / 工作记忆 | 系统提示词中的动态 `<self_audit>` 段落 |
| 2. 进度账本 | dlPFC 执行控制 | 准入轮次上的 `<progress_ledger>` 说明指令 |
| 3. 规避检测器 | 前扣带皮层（ACC） | 确定性冲突信号检测（`NO_VERIFICATION`、`PREMATURE_COMPLETE`） |
| 4. 监督批判 | 深度推理 / 元认知裁决者 | 具备故障闭合裁决解析的 LLM 评估调用 |
| 5. 完成门禁 | 基底神经节 go/no-go 回路 | 在获得批准前拦截阻止 `update_goal(complete)` 的执行拦截器 |

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

本节阐明监督器如何协同处理提示词丰富化、确定性规避启发式检测以及完成门禁控制。

### 设计

- **故障闭合完成门禁。** 对 `update_goal` 且动作为 `complete` 的调用将通过 `tools/post-execute` 拦截。若门禁尚未针对 Agent 的当前轮次批准完成，该调用将被拦截并重定向并附带诊断反馈。
- **确定性规避启发式。** 在调用 LLM 监督之前，`detectEvasion` 会以零 LLM 开销分析轮次事件中的未验证关闭或过早完成行为。
- **级联模型解析。** `resolveSupervisorModel` 优先尝试使用已配置的监督模型和提供方，在未配置时回退至 Agent 的活动提供方与模型。

### 源码映射

| 文件 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口、配置模式、生命周期钩子编排 |
| [`src/completion-gate.ts`](src/completion-gate.ts) | 追踪每轮批准状态的基底神经节 go/no-go 完成门禁 |
| [`src/evasion-detector.ts`](src/evasion-detector.ts) | 无需 LLM 开销的确定性规避模式检测器 |
| [`src/perseveration-detector.ts`](src/perseveration-detector.ts) | 跨轮次追踪重复失败模式的 OFC 持续错误检测器 |
| [`src/intention-tracker.ts`](src/intention-tracker.ts) | 对比声明计划与执行工具的 VTA 意图漂移检测器 |
| [`src/forward-model-analyzer.ts`](src/forward-model-analyzer.ts) | 小脑前向模型推理质量与避错分析器 |
| [`src/episodic-consolidation.ts`](src/episodic-consolidation.ts) | 适用于长程目标的海马体情景记忆巩固管理器 |
| [`src/self-audit-prompt.ts`](src/self-audit-prompt.ts) | 元认知自审系统提示词段落渲染器 |
| [`src/round-prompt-enrichment.ts`](src/round-prompt-enrichment.ts) | 准入轮次进度账本指示渲染器 |
| [`src/supervisor-prompt.ts`](src/supervisor-prompt.ts) | 供监督 LLM 使用的元认知批判提示词渲染器 |
| [`src/supervisor-call.ts`](src/supervisor-call.ts) | 监督 LLM 调用、流式处理与裁决解析器 |
| [`src/invariant.ts`](src/invariant.ts) | 运行时不变式伴随体 |

</details>

-----

<a id="further-exploration"></a>
## 延伸探索

- [目标服务](../goal/README.zh.md) — 持久化目标领域与生命周期状态。
- [目标工具](../tool-goal/README.zh.md) — 供模型检查与更新目标的工具。
- [目标轮次驱动器](../goal-round-driver/README.zh.md) — 自主延续驱动器。

-----

<a id="model-experience"></a>
## 模型体验

### 系统提示词

#### 模型看到的内容

每当根 Agent 上有活跃目标时，系统提示词中便会注入动态自审段落，指示模型维护内部进度账本并克制过早标记完成的倾向。

##### 自审指示

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

#### Token 影响

在存在活跃目标的所有请求中产生少量动态输入开销。

#### KV 缓存影响

在目标文本保持不变时前缀稳定。改变活跃目标将修改渲染的段落并使后续缓存条目失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **评估器 LLM 延迟** — 当检测到规避信号时，第 4 层会在轮次停止阶段调用 LLM 进行评估，从而给产生规避倾向的轮次引入往返延迟。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

本开发备注是供维护者参考的工作上下文，明确不具备权威性。五层架构直接映射了认知神经科学中的执行控制与冲突监测模型。

</details>
