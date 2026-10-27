# compactaudit

压缩摘要丢了什么，逐条列出来。

给 coding agent 的 compaction summary 做覆盖率审计：把原文里的文件路径、用户约束、命令、失败信息和 TODO 逐条对照摘要，标出没活下来的那些。零依赖、不联网、不调用模型。

```bash
git clone https://github.com/kylemarvin884/openbot-compactaudit
cd openbot-compactaudit
npm run demo        # 合成 transcript，一条命令看完整输出
```

`npm run demo` 的真实输出（Node 24，Windows；数字来自合成 fixture，不是用户会话）：

```text
compactaudit 0.1.0
transcript  demo/.run/session.jsonl  (jsonl, 8 messages, 545 chars)
summary     inline at line 9  (424 chars, 78% of source text)
scope       messages before line 9

Coverage  9/13 atoms kept  (69%)  grade D

  paths       3/4     ████████░░   75%
  constraints 3/4     ████████░░   75%
  commands    1/1     ██████████  100%
  todos       1/2     █████░░░░░   50%
  failures    1/2     █████░░░░░   50%

Need review (4 of 13: 3 dropped, 1 partial)
  ~ constraints user:1         must keep Node >= 22 compatibility;   [missing: compatibility]
  ✗ paths       asst:2         src/pricing.mjs
  ✗ failures    user:5         FAIL test/pricing.test.mjs > applies free shipping
  ✗ todos       user:7         We still need to check the currency formatting path.

first drop  paths (asst, line 2): src/pricing.mjs

verdict  4 atoms did not survive compaction - re-read them before continuing
exit     1 (coverage 69% < --fail-under 90)
```

这份摘要读起来是完整的：它写了做了什么、改了哪个文件、下一步是什么、不要碰什么。
但它仍然丢了 3 条、改写了 1 条。`compactaudit` 的价值就是这 4 行。

## 为什么需要

长会话一定会压缩：原文被摘要替换，摘要成为后续的「记忆」。压缩后忘记约束、忘记失败的测试、重复已经犯过的错，是反复出现的公开问题：

- Claude Code issue #6354《Claude forgets everything in CLAUDE.md after compaction》：压缩后需要重新提醒才会遵守项目约定。https://github.com/anthropics/claude-code/issues/6354
- 《Claude Saves Tokens, Forgets Everything》收集了多条用户原话，包括「压缩后完全不知道正在用的 skill」和「换个仓库后又把同样的错误提交一遍」。https://golev.com/post/claude-saves-tokens-forgets-everything/
- 《Claude Code 'Compaction Failed'》直接点名丢失的内容：具体决策、文件路径、进度状态。https://chudi.dev/blog/claude-context-management-dev-docs
- arXiv 2610.29869《Compaction Laundering》把压缩定义成 trust boundary：摘要继承原文的记忆地位，但原文被丢弃，无法再核验。https://arxiv.org/abs/2610.29869

现有工具大多在**防止**丢失（无损上下文、可回溯记忆、更好的 summarizer），或者核验 agent 对「改了什么」的断言。`compactaudit` 只做一件相邻但不重叠的事：给一份已经生成的摘要打分，告诉你它漏了哪些具体条目。

## 安装

需要 Node >= 22，没有依赖。

```bash
npm install -g .     # 可选，之后直接用 compactaudit
# 或者
node src/cli.mjs --help
```

## 用法

```bash
# Claude Code 会话：自动使用 transcript 里最后一条压缩摘要
compactaudit audit ~/.claude/projects/<project>/<session>.jsonl

# 摘要单独存放：自研 harness、另一个 summarizer、手工粘贴的 summary
compactaudit audit session.jsonl --summary summary.md

# CI 门禁：只检查约束和 TODO，低于 85% 退出 1
compactaudit audit session.jsonl --category constraints,todos --fail-under 85

# 机器可读
compactaudit audit session.jsonl --json
```

选项：

| 选项 | 默认 | 说明 |
| --- | --- | --- |
| `--summary <file>` | transcript 内联 | 指定摘要文件；transcript 里有压缩边界时，仍只审计边界之前的消息 |
| `--fail-under <n>` | `60` | 覆盖率低于 n 时 exit 1；`0` 关闭门禁 |
| `--category <list>` | 全部 | `paths,constraints,commands,todos,failures` 的子集 |
| `--top <n>` | `8` | 显示多少条待复核项 |
| `--all` | 关 | 显示全部 |
| `--json` | 关 | 输出完整 JSON（含每条的 `status` / `recall` / `missing`） |
| `--quiet` | 关 | 只输出一行汇总 |

退出码：`0` 达标，`1` 低于门禁，`2` 用法错误 / 读不到文件 / 找不到摘要。
找不到摘要时明确报错，不会用 0% 覆盖率误导你。

## 它检查什么

| 类别 | 从哪里取 | 判定为 kept 的条件 |
| --- | --- | --- |
| `paths` | 用户/助手文本、`Read`/`Edit`/`Write` 的 `file_path`、tool 输出里带目录的路径 | 摘要含完整路径；只含文件名时算 kept 但标 `weak` |
| `commands` | Bash 类 tool call 的 `command`、反引号和 `$` 开头的命令行 | 摘要含完整命令，或含前两个 token（`npm test`） |
| `constraints` | **只取用户消息**里含 must / never / do not / 必须 / 不要 / 禁止 等的句子（纯文本 transcript 视为用户笔记） | 关键词召回 ≥ 65% |
| `todos` | 任意消息里的 TODO / next step / 下一步 / 待办 | 关键词召回 ≥ 60% |
| `failures` | `FAIL` / `Error:` / `Traceback` / `AssertionError` / `exit code N` 行 | 关键词召回 ≥ 50% |

召回 ≥ 40% 但没到阈值的，标成 `~ partial`，并在行尾给出 `[missing: ...]`。
`partial` 多半是改写，需要人看一眼；`✗` 是完全找不到。
覆盖率只统计 `kept`，所以 `partial` 会拉低分数，这是故意的。

## 三个真实用例

1. **`/compact` 之后继续之前**。自动读取会话文件，先看被丢掉的是不是「不要改 payments/」「Node >= 22」这类硬约束。有的话在下一轮开头补回去，比事后 debug 便宜。
2. **自研 harness 的 compaction 回归**。同一份 transcript，用两个 summarizer 各生成一份摘要，分别 `--summary` 审计，比较 `dropped` 列表。这是可复现的 A/B，不需要模型当裁判。
3. **交接前**。和 [handoffcheck](https://github.com/kylemarvin884/openbot-handoffcheck) 互补：`handoffcheck` 校验 `HANDOFF.md` 里的 commit / 文件 / TODO 是否还成立，`compactaudit` 校验交接摘要有没有漏掉约束和失败信息。

## 已知限制

- **只测字面存活**。摘要用同义词改写就会漏判。demo 里的 `must keep Node >= 22 compatibility` 被摘要写成 `Node >= 22 must stay supported`，工具只能标 `partial` 并显示缺了 `compatibility`。
- **中英混合会漏**。中文按 bigram 召回，英文摘要不共享这些 bigram；工具会报 dropped，但语义上可能是保留的。
- **不判断摘要对不对**。它只回答「这个条目还在不在」，不回答「摘要是否准确」。摘要可以保留一句话但把意思写反。
- **不检测注入**。arXiv 2610.29869 里的攻击发生在序列化层（把角色 flatten 成字符串），本工具在摘要生成之后工作，不能替代那里的修复。
- **不是 token 计数器**。只报字符数，不做 tokenizer 估算。
- **尚未在真实长会话上测量误报率**。本机没有足够长的 Claude Code 会话可测，demo 与测试全部使用合成 fixture；发布时的数字不代表用户数据。如果你跑出大量噪音，欢迎开 issue 附上（脱敏后的）分类统计。

## 设计约束

- Node >= 22，ESM，零依赖，零网络，零模型调用。
- 只读文件，不执行 transcript 里的命令。
- 同一输入永远得到同一输出；没有随机性，没有时间相关的评分。
- 测试：`npm test`，24 个用例，覆盖解析、提取、匹配、门禁和 CLI 退出码。

## License

MIT
