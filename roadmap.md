# CoAuthor 愿景与交互设计

> 版本：V0  
> 最后更新：2026-02-02  
> 状态：愿景文档（指导性）

本文档描述 CoAuthor 的产品愿景、用户体验设计、交互逻辑。

> **技术实现细节请参考**：
> - [ARCHITECTURE.md](docs/ARCHITECTURE.md) - 架构设计
> - [DOMAIN.md](docs/DOMAIN.md) - 领域模型
> - [MILESTONES.md](docs/MILESTONES.md) - 里程碑计划

---

## 0. 背景与定位

CoAuthor 是一个面向 STEM 学术写作的"合著者型系统"：

- **User = Reviewer/PI**：提出需求、提供事实与资产（实验、图、代码、数据）、做最终裁决（接受/拒绝/调整）。
- **LLM Agents = Co-author/Postdoc**：主动规划、起草、逐段落修改，产出可审阅的计划与可回滚的 patch，并持续维护一致性。

**核心差异**：写作不可像 coding 那样用 test case 验证"正确性"。因此 CoAuthor 的工程策略是：
- 将"正确性"替换为 **可审计、可追踪、可回滚、可编译（LaTeX）**；
- 将"生成质量"替换为 **计划先行（plan-first）、小步修改（patch-first）、人类确认（review-first）**；
- 将"上下文理解"工程化为 **Outline 契约 + 稳定 Brief/Style + 局部段落范围 + 资产引用**。

---

## 1. V0 目标与非目标

### 1.1 V0 目标（必须达成）

1. **端到端跑通 Claude Code 风格的主流程**
   - 用户通过 REPL 输入请求（chat 指令或 slash 命令）
   - 系统将请求统一封装为 Task，进入共享的任务池（Billboard）
   - Agent 领取 Task，构建上下文，先输出 **修改计划（plan）**，再输出 **patch（diff）**
   - 用户审阅并确认应用 patch
   - 文件变更被监控，Agent 对用户手动修改具备"感知与 rebase"能力

2. **LaTeX-first 工程**
   - 主产物为 `.tex` 文件（可分章节 include）
   - 能对 patch 应用后进行最小编译检查（可选）

3. **OUTLINE.md 契约与灵活性**
   - 大纲是独立 Markdown 文档 `OUTLINE.md`，用户可随时修改
   - 系统能读取并注入 outline 作为全局上下文

4. **架构可扩展**
   - CLI 仅为一种 Adapter；未来可接 Overleaf/Chrome 插件
   - V1 的 TODO comment 异步池，只需新增 Adapter + 调度策略

### 1.2 V0 非目标（明确不做或弱化）

- 不做 GUI / Web 产品（仅 CLI REPL；可选 Ink TUI）
- 不做复杂多 Agent 群体协作（V0 只需 1 个 Default Agent）
- 不做强 RAG/Related Work 完整流水线（可留接口）
- 不强制自动把 TODO 写进 tex 注释

### 1.3 关键约束（必须遵守）

| 约束 | 说明 |
|------|------|
| 不得猜测图表含义 | 结果解释必须来自用户提供的资产元信息 |
| Patch → Review → Apply | 禁止静默覆盖文件 |
| Task 不细分类 | 任务类型由 Agent workflow 决定 |

---

## 2. 核心理念

### 2.1 Actor 一等公民

- **Actor** = 能参与任务协作的主体：Human User 或 LLM Agent
- User 只是带特殊权限/标记的 Actor

### 2.2 Task 驱动协作

- 所有交互都被统一抽象为 **Task**
- 所有产出都作为 **TaskEvent** 写入事件流

### 2.3 Billboard（共享任务池）

- **Event Store**（追加写、可回放）
- **Projection**（派生读模型）
- **RxJS Streams**（实时订阅、调度）

---

## 3. 用户交互设计

### 3.1 REPL 交互模式

V0 提供一个长期运行的 REPL：

- 用户既可以"像聊天一样"直接输入自然语言
- 也可以用 `/` 命令显式触发
- REPL UI 支持"附着到某个任务线程"（attach），呈现 Agent 的工作流进度

### 3.2 命令集（最小集合）

#### Task 创建类

| 命令 | 说明 |
|------|------|
| `/ask <text>` | 创建 foreground Task |
| `/edit <file:range> <text>` | 创建 Task 并附带 artifactRefs |
| `/draft <outlineAnchor> <text>` | 创建 Task，强注入 OUTLINE.md |
| `/tweak <file:range> <goal> --n 3` | 创建 Task，期望多个候选 |
| `/todo add <file:range> <comment>` | 创建 background Task（V1） |

#### Review / Control 类

| 命令 | 说明 |
|------|------|
| `/tasks` | 列出 open / awaiting_review 任务 |
| `/open <taskId>` | 附着到 task thread |
| `/accept [proposalId\|latest]` | 接受 patch proposal |
| `/reject [proposalId] [reason]` | 拒绝 patch |
| `/followup <text>` | 在当前 thread 追加反馈 |
| `/cancel` | 取消当前任务 |

### 3.3 Plan-first 输出规范

对于任何会修改文本的任务，Agent 必须按固定模板输出两段结构化产物：

#### 1) Plan（修改计划）

```yaml
Goal: 修改目标
Issues: 识别到的问题
Strategy: 采取的策略
Scope: 改动范围（哪些段落/section）
Risks: 风险提示
Questions: 阻塞性问题（如需）
```

#### 2) Patch Proposal（差异补丁）

- Unified diff 格式
- 包含目标文件 path
- 包含 baseRevision（用于 drift 检测）
- 包含 proposalId

用户看到 plan 后再看 patch，最终用 `/accept` 应用。

---

## 4. 工作流场景

### 4.1 典型场景：修改某段落

```
User: /edit chapters/01_intro.tex:10-20 把这段改得更学术一点

Agent: [claiming task...]

Agent: [AgentPlanPosted]
  Goal: 提升第一章引言 10-20 行的学术性
  Issues: 当前使用了口语化表达
  Strategy: 替换为被动语态，添加学术术语
  Scope: 01_intro.tex 第 10-20 行
  
Agent: [PatchProposed]
  --- a/chapters/01_intro.tex
  +++ b/chapters/01_intro.tex
  @@ -10,5 +10,5 @@
  -This thing is really fast.
  +The proposed architecture demonstrates significant latency improvements.

User: /accept
Applied patch -> chapters/01_intro.tex
```

### 4.2 典型场景：用户中途手改

```
User: /edit chapters/02_method.tex:50-60 展开这段

Agent: [claiming task, baseRevision=abc123]

# 用户在 Agent 工作期间手动修改了 02_method.tex

Agent: [TaskNeedsRebase]
  Detected drift in 02_method.tex (was abc123, now xyz789)
  Auto-rebasing to latest version...

Agent: [AgentPlanPosted]
  (Plan based on latest file content)
  
Agent: [PatchProposed]
  (Patch based on latest file content, baseRevision=xyz789)
```

### 4.3 典型场景：多候选

```
User: /tweak chapters/03_result.tex:100-105 让这句更简洁 --n 3

Agent: [PatchProposed] Option A (concise)
Agent: [PatchProposed] Option B (formal)
Agent: [PatchProposed] Option C (emphatic)

User: /accept patch_optionB
```

---

## 5. 资产管理原则

### 5.1 资产类型

| 类型 | 说明 | 元信息要求 |
|------|------|------------|
| `tex` | LaTeX 源文件 | - |
| `outline_md` | 大纲文件 | - |
| `figure` (schematic) | 示意图（如 pipeline） | source, purpose |
| `figure` (result) | 结果图（如柱状图） | source, purpose, **message** |
| `code` | 关键实现代码 | source, purpose |
| `data` | 实验数据 | source, purpose |

### 5.2 关键约束

- **结果图必须有 message**：用户必须告诉系统"这张图想说明什么"
- **Agent 不得猜测数据含义**：只能描述视觉特征（趋势、颜色），不能解释实验结论
- **代码资产用于 Method 章节**：Agent 可以从代码提取算法描述

---

## 6. 上下文策略

### 6.1 全局上下文（始终注入）

| 文件 | 说明 |
|------|------|
| `OUTLINE.md` | 论文大纲（必须存在） |
| `BRIEF.md` | 文章做什么、贡献、读者（可选） |
| `STYLE.md` | 语气、术语表、禁用词（可选） |

### 6.2 局部上下文（按需注入）

- Task 指定的 artifactRefs 范围
- 相邻段落（减少重复）
- 相关资产的元信息

### 6.3 缺失处理

- 若 OUTLINE.md 不存在，提示用户创建
- 若 BRIEF.md/STYLE.md 不存在，优雅降级（但提示建议创建）

---

## 7. V1 预留功能

以下功能明确延后到 V1，但 V0 架构必须预留扩展点：

| 功能 | 说明 |
|------|------|
| TODO 异步池 | `/todo add` 创建 background task |
| Background Scheduler | 后台自动执行低优先级任务 |
| Overleaf 插件 | 选区 → artifactRefs → Task |
| 多 Agent | ReviewerAgent, InterviewerAgent |
| Related Work RAG | 文献检索、三层材料 |

---

## 8. 项目结构（论文工作区）

```
my-thesis/
├── OUTLINE.md              # 大纲（必须）
├── BRIEF.md                # 项目简介（建议）
├── STYLE.md                # 风格指南（建议）
├── main.tex                # 主文件
├── chapters/
│   ├── 01_introduction.tex
│   ├── 02_background.tex
│   └── ...
├── figures/                # 图表
├── code/                   # 关键代码
├── bib/
│   └── refs.bib
└── .coauthor/              # CoAuthor 工作目录
    ├── coauthor.db         # Event Store
    └── patches/            # Patch 历史
```

---

## 附录：与 Claude Code 的对比

| 特性 | Claude Code | CoAuthor |
|------|-------------|----------|
| 目标 | 代码编写 | 学术写作 |
| 验证 | Test case | 可编译 + 可回滚 |
| 最小单位 | 函数/文件 | 段落 |
| 上下文 | AST + LSP | OUTLINE + BRIEF + STYLE |
| 主流程 | Think → Act → Observe | Plan → Patch → Review |
| Adapter | CLI | CLI（V0）→ Overleaf（V1） |
