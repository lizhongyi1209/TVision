---
name: orchestrator-sonnet-workers
description: 用户要求主会话（Fable 5）当大脑做任务拆解与管理，具体执行派发给跑 claude-sonnet-5 的子 agent
metadata: 
  node_type: memory
  type: feedback
  originSessionId: cf8c0b97-09bd-45d1-958f-d6f2e0428651
---

用户（2026-07-08）明确要求的协作模式：主会话作为编排者/大脑，负责理解需求、拆分任务、汇总验证；具体执行工作交给子 agent，且子 agent 必须使用 `claude-sonnet-5`。

**Why:** 用户走的是 nexaxis.ai 自定义网关，希望把贵的 Fable 5 只用在规划/决策上，批量执行用 Sonnet 5 控制成本。

**How to apply:** 已在 `~/.claude/settings.json` 的 `env` 里设置 `CLAUDE_CODE_SUBAGENT_MODEL: "claude-sonnet-5"`，它强制所有子 agent（含 Workflow 里的 agent()）跑 Sonnet 5，优先级高于 per-call `model` 参数和 agent 定义的 frontmatter。因此正常用 Agent 工具派发即可，无需每次传 model。对可拆分的任务应主动拆解并行派发，而不是自己在主循环里逐个执行。若某个子任务确实需要 Fable 5，需先提醒用户该环境变量会覆盖 per-call 指定。
