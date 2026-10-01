---
description: "元认知目标监督器：提示词段落、基于记录证据的启发式检查、评估器模型与完成检查。"
kind: "package-reference"
---

# @deepseek-ai/dsh-goal-supervisor

[English](README.md) | 中文

## 概述

`dsh-goal-supervisor` 结合提示词段落、针对已记录会话事件的模式检查、一次评估器模型调用、定期由模型撰写的摘要，以及针对模型调用目标完成工具的执行前检查。各层名称借用神经科学术语，仅作为灵感来源：每一层都是提示词、正则或事件模式启发式检查，或一次模型调用，没有任何一层模拟脑区。需要审查自主目标完成情况时，可将它与 `dsh-goal` 和 `dsh-goal-round-driver` 一同挂载。

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

在 Cordis 配置文件中将 `dsh-goal-supervisor` 与 `dsh-goal` 及 `dsh-goal-round-driver` 一同挂载。它作用于每个拥有自身活跃目标的 Agent。

### 配置

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

除非同时设置 `supervisorProvider` 和 `supervisorModel`，评估器会使用当前 Agent 的提供方和模型。验证检测采用启发式：若 `bash` 或 `pwsh` 调用的 `command` 运行了可识别的测试、构建、类型检查或 lint 程序，且其记录结果不是错误、也不以失败的退出码、信号或超时标记结尾，则计为验证。它不会确认命令是否足以验证目标。

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-goal-supervisor)是所有受支持字段的权威来源。

### 轮次停止时的 steering

拥有活跃目标的 Agent 每次触发 `agent/turn-stopping` 时，监督器会收集第 3 层信号并调用评估器；当评估器返回 `redirect`，或该轮次调用了 `codeChangeTools` 中的工具、且最后一次此类调用之后没有成功且可识别的验证结果时，它会向 Agent 发送一条批判消息进行 steering（中途引导）。未修改代码的轮次（例如调研或文档工作）不会因缺少验证而被引导。同一目标修订号的一个轮次内最多进行 `maxConsecutiveRedirects` 次引导；超出后监督器记录一条警告、跳过评估器，并允许轮次结束。评估器调用失败、超时、被取消，或未返回可识别的 JSON 裁决时，结果为 `abstain`，既不引导也不拒绝。

<a id="completion-check"></a>
### 完成检查

`tools/pre-execute` 监听器会拒绝 `update_goal(complete)`，除非请求指向活跃目标及其修订号，且会话中最后一次 `codeChangeTools` 调用（如有）之后记录了成功且可识别的验证结果。未修改代码的目标仅由评估器判断。随后评估器审查该轮次：`redirect` 会附带批判意见拒绝请求，`approve` 允许请求；`abstain` 也允许请求并记录警告，因为所有已记录的代码修改都已验证；被取消的调用会被拒绝。每次评估器和巩固请求都会在 `supervisorTimeoutMs` 后，或在发起请求的轮次或工具调用被取消时中止，因此该检查不会无限等待。调用之间不缓存任何内容：每个完成请求都依据其所在轮次单独评估。

### 各层

| 层级 | 灵感来源 | 作用 |
|---|---|---|
| 1. 自审提示词 | 工作记忆复述 | 为正在组装提示词的 Agent 提供系统提示词段落：重述目标、要求提供有证据支撑的账本，并禁止编写镜像实现的测试 |
| 2. 进度账本 | 前额叶目标维持；岛叶显著性 | 在每个准入的目标轮次前添加通知，附带同一目标修订号最近一次 redirect 给出的按风险排序的任务列表 |
| 3a. 规避检查 | 前扣带皮层冲突监测 | 根据已记录的工具调用和结果计算 `NO_VERIFICATION`、`PREMATURE_COMPLETE` 与 `INSUFFICIENT_WORK` 信号 |
| 3b. 持续错误检查 | 眶额皮层反应抑制 | 当相同的失败结果签名（工具、失败代码、输出前缀）连续三个轮次出现时给出 `PERSEVERATION`；非零退出码标记计为失败 |
| 3c. 意图漂移 | 奖励预测误差，仅借用名称 | 推理中出现未被否定的承诺（如 "I will run the tests" 或 "let me compile"）而该轮次没有成功的验证记录时给出 `INTENTION_DRIFT` |
| 3d. 含糊措辞 | 小脑前向模型，仅借用名称 | 在没有成功验证的轮次中，推理匹配两个及以上含糊或回避验证的措辞时给出 `WEAK_REASONING`；这是措辞计数，不是预测模型 |
| 4. 评估器 | 元认知判断 | 每次轮次停止以及每个通过验证检查的完成请求各调用一次模型，返回 `approve`、可附带显著性列表的 `redirect`，或 `abstain` |
| 4.5. 情景巩固 | 海马体巩固 | 每隔 `consolidationInterval` 个轮次生成一份模型撰写的摘要，以带引号的不可信数据形式出现在同一 Agent、同一目标修订号的系统提示词中 |
| 5. 完成检查 | 基底神经节 go/no-go | [完成检查](#completion-check)中描述的 `tools/pre-execute` 拒绝逻辑 |

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

本节阐明监督器如何读取已记录的证据、调用评估器，以及如何限定每个 Agent 的状态范围。

### 设计

- **面向模型的完成审查。** 完成检查在 `tools/pre-execute` 中、`update_goal` 主体执行之前运行。直接调用目标服务不会经过此工具检查。
- **已记录的证据。** 第 3 层只读取当前轮次会话事件中的调用、结果和推理，其中包括通过 PTC 执行、且子调度结果已记录的 `bash` 和 `pwsh` 调用。同一个 `run_code` 调用中的完成请求会被拒绝，因为 PTC 会在该调用结束时记录这些结果。
- **限定范围的状态。** 提示词段落从组装上下文中读取 Agent。显著性列表、巩固摘要和引导预算按 Agent 存储，并绑定到一个目标 ID 和修订号；编辑目标或创建新目标会从空状态开始，批准完成会清除显著性列表，Agent 销毁会丢弃全部状态。持续错误检查对一个被引导的轮次只计一次，并使用其最近一次停止。
- **记录评估器调用。** 每次评估器和巩固请求都会记录完整系统提示词、提供方、模型、选项和用户文本；配对事件会记录原始响应或失败状态。这些仅写入日志的事件不会进入 Agent 派生的对话历史。
- **级联模型解析。** 当配置的提供方和模型均有效时，`resolveSupervisorModel` 会使用它们；否则使用当前 Agent 的提供方和模型。
- **进程内巩固。** 摘要在当前进程中跨上下文压缩保留。进程重启后，会在下一个配置的巩固间隔从会话事件重建摘要。

### 源码映射

| 文件 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口、配置模式、引导预算、完成检查、生命周期监听器 |
| [`src/recorded-activity.ts`](src/recorded-activity.ts) | 从会话事件读取的已记录调用、结果、失败标记与推理 |
| [`src/evasion-detector.ts`](src/evasion-detector.ts) | 可识别的验证命令与第 3a 层信号 |
| [`src/perseveration-detector.ts`](src/perseveration-detector.ts) | 失败结果签名与连续轮次计数器 |
| [`src/intention-tracker.ts`](src/intention-tracker.ts) | 带分句否定处理的验证承诺模式 |
| [`src/forward-model-analyzer.ts`](src/forward-model-analyzer.ts) | 含糊措辞计数器 |
| [`src/episodic-consolidation.ts`](src/episodic-consolidation.ts) | 进程内增量摘要管理器 |
| [`src/self-audit-prompt.ts`](src/self-audit-prompt.ts) | 自审系统提示词段落渲染器 |
| [`src/round-prompt-enrichment.ts`](src/round-prompt-enrichment.ts) | 准入轮次的进度账本渲染器 |
| [`src/supervisor-prompt.ts`](src/supervisor-prompt.ts) | 评估器系统提示词渲染器 |
| [`src/supervisor-call.ts`](src/supervisor-call.ts) | 评估器请求、超时信号、日志记录与裁决解析器 |
| [`src/session-events.ts`](src/session-events.ts) | 辅助监督模型请求及结果的持久化、仅日志事件类型 |
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

拥有自身活跃目标的 Agent 会在系统提示词中看到自审段落。每个准入的目标轮次还会以一条 `<progress_ledger>` 通知开始；被引导的轮次会收到一条以 `[Metacognitive Supervisor]:` 开头的通知，其后是评估器的批判意见或缺少验证的指示。

##### 自审指示

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

#### Token 影响

在存在活跃目标的所有请求中产生少量动态输入开销。

#### KV 缓存影响

在目标文本保持不变时前缀稳定。改变活跃目标将修改渲染的段落并使后续缓存条目失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **评估器 LLM 延迟** — 有活跃目标时，第 4 层会在每次轮次停止时调用评估器（直到引导预算耗尽），并在每个通过验证检查的完成请求执行前调用评估器。
- **启发式验证** — 包会将可识别命令及其成功工具结果视为验证证据，但不会判断命令是否充分验证了目标。通过 shell 命令进行的文件修改不计为 `codeChangeTools` 调用。
- **英文措辞启发式** — 意图漂移和含糊措辞模式只匹配英文措辞；否定处理只检查承诺之前的分句。
- **评估器 abstain 时放行** — 评估器不可用时，已验证的完成请求会被允许，轮次只会在修改代码后缺少验证时被引导。
- **面向模型的范围** — 完成检查会拦截 `update_goal` 工具执行；直接调用目标服务的代码不受此检查覆盖。
- **巩固持久性** — 情景摘要保存在进程内存中，进程重启后会在下一个巩固间隔从会话事件重建。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

本开发备注是供维护者参考的工作上下文，明确不具备权威性。神经科学名称用于帮助读者理解各层的意图，并不表示这些启发式检查再现了相应机制。

</details>
