# claude-sync · Claude Code 工作区上下文（已脱敏）

> 目的：换电脑后恢复「同一个 Claude Code 工作状态」——编排配置、项目记忆、完整对话转录。
> 项目代码本身的接力说明看仓库根目录的 [HANDOFF.md](../HANDOFF.md)。

## 安全说明（先读）

- 所有会话转录里的 nexaxis 网关令牌已全部替换为 `sk-REDACTED`（含前缀），提交前已 grep 验证零残留。
- `user-settings.json` 里 `ANTHROPIC_AUTH_TOKEN` 是占位符 `REPLACE_WITH_YOUR_NEXAXIS_TOKEN`，恢复时填回真实令牌。
- o1key 生图令牌从未进入转录（`data/` 整目录已 gitignore），到家后在应用设置面板重填即可。

## 内容清单

| 文件 / 目录 | 是什么 | 恢复到哪里 |
|---|---|---|
| `user-settings.json` | 用户级 Claude Code 配置：nexaxis 网关、主模型 fable-5、`CLAUDE_CODE_SUBAGENT_MODEL=claude-sonnet-5`（编排模式的核心）等 | 合并进 `~/.claude/settings.json`，令牌换成真实值 |
| `memory/` | 项目持久记忆（编排模式说明 + 索引） | `~/.claude/projects/<本项目目录>/memory/` |
| `sessions/*.jsonl` | 今日完整主会话转录（截至 commit 前一刻） | `~/.claude/projects/<本项目目录>/` |
| `sessions/cf8c0b97…/` | 同会话的子 agent 转录 + 工具结果 | 同上，跟 jsonl 放一起 |
| `skills-list.txt` | 本机已装 skills 清单（skills 本体未入库） | 参照下方重装 |
| `../.claude/settings.local.json` | 项目级权限白名单（随仓库走，已强制加入 git） | 拉取即得，无需操作 |

`<本项目目录>` 的确定方法：在新机器上进入仓库目录跑一次 `claude`，`~/.claude/projects/` 下会出现一个以项目绝对路径命名的文件夹（形如 `C--Users-你-Desktop-o1key-vision-workbench`），把 memory 和 sessions 拷进去。之后 `claude --resume` 可以看到历史会话；即使跨机器无法直接 resume，jsonl 也是完整对话记录，可以让 Claude 直接读它找回上下文。

## 快速恢复步骤

1. `git clone` 本仓库 → `npm ci` → `npm run dev`（详见 HANDOFF.md 第二节）
2. `user-settings.json` 内容合并到 `~/.claude/settings.json`，填回真实网关令牌
3. 仓库目录里跑一次 `claude`，然后拷入 `memory/` 与 `sessions/`
4. 按 `skills-list.txt` 重装需要的 skills（今日用到的两个：
   `design-taste-frontend` ← github.com/Leonxlnx/taste-skill；
   `web-access` ← github.com/eze-is/web-access；
   装法：clone 后拷到 `~/.claude/skills/<名字>/`，或直接让 Claude 装）
5. 应用右上角 ⚙ 填 o1key 令牌 → 跑通 P0 真实出图（见 HANDOFF 待办）
