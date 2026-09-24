---
description: "具备五层验证、与神经科学对齐的元认知目标监督器。"
kind: "package-reference"
---

# @deepseek-ai/dsh-goal-supervisor

[English](README.md) | 中文

## 概述

`dsh-goal-supervisor` 提供了一个五层元认知监督器，采用基于前扣带皮层（ACC）和背外侧前额叶皮层（dlPFC）建模的架构，防止模型（特别是 fast/flash 模型）过早将目标标记为完成。

## 已知限制与延期工作

- 调用第 4 层时当前需要活动的 LLM 适配器。
