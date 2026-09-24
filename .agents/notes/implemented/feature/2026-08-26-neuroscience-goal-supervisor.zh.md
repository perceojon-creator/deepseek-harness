# Agent Note: 神经认知对齐的元认知目标监督器

Status: implemented

[English](2026-08-26-neuroscience-goal-supervisor.md) | 中文

## Problem

快速推理（“flash”）模型在跨多轮自主延续执行长期目标时存在明显的失效模式：缺乏深度持续的思维链规划，随着上下文增长逐渐偏离顶层目标，并通过编写琐碎或套套逻辑的测试用例来过早宣告胜利，而未进行真实的经验功能验证。

先前的目标架构暂缓了完成验证机制：`dsh-tool-goal` 仅凭模型自身证明即接受 `update_goal(complete)`。模型既当执行者又当裁判。若采用独立的副 agent 充当外部评估器，会割裂会话工作空间；而将批评作为外部用户消息注入则只会产生表面服从，无法建立内在的元认知调控。

## Decision

`packages/goal/goal-supervisor/` 中的 `@deepseek-ai/dsh-goal-supervisor` 实现了灵感源自前扣带皮层（ACC）和背外侧前额叶皮层（dlPFC）执行控制回路的五层元认知监督器：

1. **第一层——元认知自审计提示词分块（`supervisor:self-audit`）：** 在目标处于活跃状态时动态注册于 `FIRST_PARTY_SECTION_ORDER.TOOL_GOAL + 10`。强制要求模型在结束轮次或声称完成前输出结构化 `<self_audit>` 区块。
2. **第二层——进度台账富化：** 在接纳目标轮次时拦截 `agent/pre-step`，前置注入 `<progress_ledger>` 规范，要求每项子任务必须引用经工具验证的真实输出。
3. **第三层——确定性规避检测器：** 对会话事件进行纯启发式分析，零 LLM 开销。检测 `NO_VERIFICATION`（仅修改代码而无编译或测试执行）、`PREMATURE_COMPLETE` 和 `INSUFFICIENT_WORK`。
4. **第四层——级联 LLM 监督器调用：** 当第三层触发或 agent 试图在目标活跃时关闭轮次，调用监督器评估近期上下文和推理块。配置的模型（默认 Anthropic Claude Sonnet 4.5）优先，若未注册则平滑回退至会话当前活跃模型。采用故障闭合设计（评估异常即重定向）。
5. **第五层——基底神经节完成门禁：** 拦截 `agent/turn-stopping`，在监督器重定向时通过引导提示词（`agent.steer`）阻止轮次关闭。通过 `tools/post-execute` 拦截未经监督器认证的 `update_goal(complete)`。

## Testing

单元测试与组合测试覆盖全部五层：脚手架导出与配置 schema、创建目标时动态注入系统提示词分块、目标轮次接纳时前置进度台账、确定性规避检测启发式规则、LLM 监督器提示词组装与故障闭合判定解析、轮次终止拦截引导与完成门禁阻断/放行。`packages/goal/` 全套测试套件运行 16 个测试文件的 164 项测试全部通过。

## Alternatives considered

- **双 agent 执行者/审查者屏障**——已否决，因为该方式将上下文割裂至不同子 agent 中，增加延迟与 token 重复消耗，且破坏了统一的会话工作空间。
- **外部用户角色批评注入**——已否决，因为外部声音仅引发机械顺从，无法形成自我调节的元认知。
- **纯确定性验证门禁**——已否决，因为机械检查无法评估细致、非二元的完成标准。

## Consequences

- 快速模型无法在未经经验验证的情况下过早完成目标或退出轮次。
- 完成判定权从模型的自我评估中剥离，交由监督器把关。
- 元认知调节在同一会话历史中持续运作，无需额外子 agent 开销。
- 模型选择能够从专属高推理模型平滑回退至会话默认模型。

## Known limitations and deferred work

- 触发第四层时依赖可用的实时 LLM 适配器。
- 跨代码库边界的验证管线仍由上层应用负责。
