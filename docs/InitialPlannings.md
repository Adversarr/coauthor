# Claude Code设计架构

## 🧑‍💻 User

vibe coding (例如cursor、claude code）一般的实现架构是什么样的。

---
## 🤖 Assistant

“Vibe Coding” 这个词通常指代**基于自然语言意图（Intent-based）、高度自动化、且具备上下文感知能力**的编程体验。

像 **Cursor**（基于 VS Code 二次开发的 IDE）和 **Claude Code**（基于 CLI 的 Agent 工具）之所以能提供“如丝般顺滑”的体验，核心在于它们不仅仅是简单的“调用 API”，而是构建了一套复杂的**上下文感知与工程化架构**。

以下是这类工具通用的实现架构深度解析：

---

### 1. 核心架构概览

整体架构通常分为四层：
1. **交互层 (Interaction Layer)**：IDE 插件、CLI 或 独立 IDE（如 Cursor）。
2. **上下文检索引擎 (Context Engine)**：这是核心壁垒，决定了 AI 是否“懂”你的整个项目。
3. **编排与推理层 (Orchestration & Reasoning)**：Prompt 工程、Tool Calling、Agent 循环。
4. **模型层 (Model Layer)**：底层 LLM（Claude 3.5 Sonnet, GPT-4o, DeepSeek 等）。

---

### 2. 关键模块详解

#### A. 上下文检索引擎 (The Context Engine) —— 它是如何“读懂”全库的？

LLM 的 Context Window（上下文窗口）虽然在变大，但仍然有限且昂贵。你不能每次都把几百万行代码塞进去。因此，架构的核心是 **RAG (Retrieval-Augmented Generation) for Code**。

* **本地索引 (Local Indexing)**：
 * **Embeddings (向量索引)**：将代码片段切分（Chunking），转化为向量存入本地向量数据库（如 LanceDB, SQLite with Vector）。这用于语义搜索（例如用户问“鉴权逻辑在哪”，它能找到 `auth.ts`）。
 * **Keyword Search (关键词索引)**：传统的 BM25 算法，用于精确匹配变量名。
* **代码结构感知 (AST & Tree-sitter)**：
 * 工具会使用 `Tree-sitter` 等解析器生成 **AST (抽象语法树)**。它不只是把代码当文本，而是理解 `Class`、`Function`、`Import` 之间的依赖关系。
 * **引用图谱 (Dependency Graph)**：当你在 A 文件修改代码，AI 知道 B 文件引用了 A，因此需要同时检查 B。
* **最近上下文 (Shadow Workspace)**：
 * 记录用户刚刚看过哪些文件、光标停留在哪里、甚至终端报错是什么。

#### B. 编排与推理层 (Orchestration) —— 它是如何“思考”的？

当用户输入“把登录页面的背景改成蓝色”时，后台发生了什么？

1. **意图识别**：路由层判断这是在问代码逻辑、还是要求修改代码、还是执行终端命令。
2. **Prompt 组装**：
 * **System Prompt**：定义角色（“你是一个资深全栈工程师...”）。
 * **Dynamic Context**：从检索引擎中拉取最相关的 5-10 个文件片段注入 Prompt。
 * **LSP Diagnostics**：如果代码有红线报错，IDE 会通过 **LSP (Language Server Protocol)** 获取错误信息并注入 Prompt。
3. **Agentic Loop (代理循环)** —— *Claude Code 的核心*：
 * 它不是一次性生成的。
 * **Think**：模型决定先读取文件 A。
 * **Act**：调用工具 `read_file(A)`。
 * **Observe**：获取文件内容。
 * **Think**：发现需要修改，生成 `diff`。
 * **Act**：应用修改。
 * **Verify**：运行测试或检查 Lint 错误（Self-correction）。

#### C. 输出与应用层 (Application Layer) —— 它是如何“写”代码的？

这是 Cursor 和普通 Copilot 插件最大的区别所在。

* **Diff 生成与流式应用**：
 * AI 不会重写整个文件，而是生成 diff（差异）。
 * **Cursor 的“Speculative Edit”（推测性编辑）**：Cursor 修改了 VS Code 的底层渲染逻辑。AI 生成代码时，Cursor 会在后台预先“应用”这些变更到一个**影子模型**中，检查是否有语法错误。如果有，它可能在展示给用户之前就自我修正，或者高亮潜在风险。
 * **快速应用 (Fast Apply)**：Cursor 训练了一个专门的小模型（Model Distillation），专门用于快速将 AI 的建议填入光标位置，速度比通用大模型快得多。

---

### 3. 具体案例分析

#### 案例一：Cursor (Deep IDE Integration)

Cursor 是 VS Code 的 Fork 版本，这给了它极大的权限：

* **架构特点**：Native control (原生控制)。
* **实现方式**：
 * **Co-Pilot++ / Tab预测**：它不仅仅预测下一个词，它预测你光标**下一个要去的地方**。这是通过记录用户历史行为序列训练的小模型实现的。
 * **Composer (Ctrl+I)**：这是一个多文件编辑 Agent。它维护一个文件列表，可以同时对多个文件发起 `apply_edit` 操作。
 * **UI 注入**：它可以直接在编辑器文本行间渲染 Diff 界面，而不是像插件那样只能在侧边栏聊天。

#### 案例二：Claude Code (Agentic CLI)

Claude Code 是一个运行在终端的 Agent，架构更偏向于 ReAct (Reasoning + Acting) 模式。

* **架构特点**：Tool-use heavy (重度工具调用)。
* **实现方式**：
 * 它将文件系统、grep、ls、git 等都封装成**Tools (工具)**。
 * 当用户下达指令，它进入一个 `While (!Done)` 的循环。
 * **安全性**：它在执行写操作或危险命令前会请求用户确认（Human-in-the-loop）。
 * **记忆压缩**：由于 CLI 会话很长，它会定期总结之前的操作，防止 Context Window 爆掉。

---

### 4. 关键技术栈总结

如果你想自己实现一个简易版的 Vibe Coding 工具，你需要：

1. **前端/客户端**：VS Code Extension API (如果是插件) 或 Electron (如果是独立 IDE)。
2. **解析工具**：`Tree-sitter` (用于快速解析代码结构)，`grep`/`ripgrep` (用于快速文本搜索)。
3. **向量数据库**：本地嵌入式数据库，如 `LanceDB` 或 `Chroma`。
4. **模型交互协议**：
 * OpenAI API 格式。
 * **MCP (Model Context Protocol)**：这是 Anthropic 最近推出的标准，旨在标准化 LLM 如何连接本地数据（文件系统、数据库）。
5. **Diff 算法**：如何优雅地将 AI 生成的代码块合并到现有文件中（不仅是文本替换，要考虑缩进、括号匹配）。

### 总结

**Vibe Coding 的本质是：IDE 不再仅仅是文本编辑器，而变成了 LLM 的“浏览器”。**

* **Cursor** 做得深，因为它改了浏览器内核（VS Code源码），实现了极致的 UI 交互和代码预测。
* **Claude Code** 做得广，因为它把操作系统当成了工具箱，实现了自主的任务规划。

未来的架构趋势是 **Model Context Protocol (MCP)** 的普及，让 IDE、终端和云端资源能通过统一接口喂给 AI，实现更强的“全栈感知”。

---
## 🧑‍💻 User

我想要实现一个类似的，vibe writing的app。

先考虑类似claude code这种cli工具。

TLDR：assistant for scientific/technical writing (e.g. STEM).

Usage：
1. as assistant 对technical writing没有经验的人群，提供协助
2. as writer 反过来 user 作为proofread，让LLM修改，然后能够建立一个最终有用户风格的文章。
3. ...

当前focus的目标人群：学生，例如我（一个即将毕业的，要写毕业论文的学生，但我没有写这类论文的经验）

给我一个*详尽*的version 0的架构设计。

---
## 🤖 Assistant

这是一个非常有价值的方向。针对 STEM 领域的学术写作（尤其是毕业论文），痛点非常痛：**结构不懂、逻辑不通、语言不地道、文献引用混乱**。

既然目标是 **Version 0 (MVP)** 且形式是 **CLI**，我们需要放弃花哨的 GUI，专注于 **"Context Aware"（上下文感知）** 和 **"Agentic Workflow"（代理工作流）**。

我们将这个工具暂命名为 **`ThesisVibe`**。

---

### 1. 核心设计理念 (Philosophy)

与代码不同，论文的最小单位不是“函数”，而是“段落”或“章节”。且论文有强烈的**层级结构（Hierarchy）**。

* **Code Vibe** = AST (抽象语法树) + LSP (语言服务协议)
* **Thesis Vibe** = **Document Tree (文档树)** + **Academic Protocol (学术规范协议)**

### 2. 技术栈选型 (Tech Stack)

为了快速构建 CLI 并利用现有的 NLP 生态，推荐：
* **语言**: Python 3.10+ (处理文本和科研数据生态最好)。
* **CLI 框架**: `Typer` 或 `Click` (配合 `Rich` 库实现漂亮的终端 UI)。
* **LLM 交互**: `LangChain` 或 `LiteLLM` (方便切换模型，初期建议用 Claude 3.5 Sonnet，写作能力最强)。
* **存储**: 本地文件系统 (Markdown/LaTeX) + `SQLite` (简单的元数据存储)。
* **RAG**: `ChromaDB` (本地轻量级向量库，用于文献检索)。

---

### 3. 系统架构设计 (Architecture)

架构分为四层：**交互层、编排层、上下文层、工具层**。

#### A. 交互层 (The Interface - CLI)
提供类似 Claude Code 的 REPL (Read-Eval-Print Loop) 环境。

* **命令模式**：
 * `/init`: 初始化论文项目结构（根据学科模板，如 CS、Bio、Physics）。
 * `/draft [topic]`: 基于简短指令起草段落。
 * `/polish`: 润色当前上下文的语言（Style Transfer）。
 * `/check`: 检查逻辑连贯性和引用格式。
* **TUI (Text UI)**: 使用 `Rich` 库渲染 Markdown，高亮修改建议（Diff View）。

#### B. 上下文引擎 (Context Engine) —— 核心壁垒

这是让 LLM 理解你“正在写什么”的关键。对于论文，不能把全文塞进去，需要分级策略：

1. **Global Context (全局上下文 - 始终存在)**:
 * `thesis.yaml`: 配置文件（题目、目标受众、研究问题 RQ、核心贡献）。
 * `outline.md`: 论文大纲树。
 * `style_guide.md`: 风格定义（"使用被动语态"、"美式拼写"、"句式简洁"）。
2. **Focus Context (焦点上下文 - 动态加载)**:
 * **Current Chapter**: 用户光标所在的章节内容。
 * **Previous/Next Chapter Summary**: 上一章的结论和下一章的引言（保证逻辑衔接）。
3. **Reference Context (引用上下文 - RAG)**:
 * **BibTeX Library**: 解析 `.bib` 文件。
 * **PDF RAG**: 用户扔进 `refs/` 文件夹的 PDF 论文，会被切片存入向量库。当 LLM 写到 "Recent studies show..." 时，它会去检索相关文献并自动引用。

#### C. 编排与推理层 (Orchestration - The Agent)

这里模仿 Claude Code 的 ReAct 循环。

**工作流示例：用户输入 "帮我写第二章关于 Transformer 的综述"**

1. **Planner (规划器)**:
 * 读取 `outline.md` 确认第二章位置。
 * 分析意图：这是 "Drafting" 任务。
 * 生成子任务列表：1. 检索 Transformer 相关文献; 2. 总结关键点; 3. 生成文本。
2. **Researcher (研究员)**:
 * 调用 `search_refs(query="Transformer architecture")`。
 * 从向量库提取 Top-5 论文摘要。
3. **Writer (作家)**:
 * 结合 Global Context (你的研究方向) 和 检索到的文献，生成文本。
 * **Style Injection**: 读取用户以前写的文本（如果有），提取特征（由 System Prompt 完成），确保风格一致。
4. **Editor (编辑 - Self-Correction)**:
 * 检查：是否有引用？是否包含口语化词汇？
 * 输出结果给用户。

#### D. 工具层 (The Tool Belt)

LLM 可以调用的实际函数：

1. `FileSystem`: `read_file`, `write_file`, `list_dir`。
2. `ReferenceManager`:
 * `lookup_citation(key)`: 查找具体文献。
 * `find_supporting_evidence(claim)`: 为某个论点找依据。
3. `StyleAnalyzer`:
 * 分析用户提供的 sample text，生成 prompt 描述（例如："User prefers short sentences, emphasizes quantitative results"）。

---

### 4. 核心功能实现细节 (Version 0 Specs)

为了实现 Vibe Writing，V0 版本必须做好以下三点：

#### 1. 结构化脚手架 (Structured Scaffolding)
不要让学生面对空白文件。

* **Feature**: `vibe init --template cs-master`
* **Action**: 创建文件夹结构：
```text
    my-thesis/
    ├── config.yaml       # 论文元数据
    ├── thesis.bib        # 参考文献
    ├── outline.md        # 核心大纲（LLM根据此理解全貌）
    ├── chapters/
    │   ├── 01_introduction.md
    │   ├── 02_literature_review.md
    │   └── ...
    └── refs/             # 存放PDF
    ```

#### 2. 风格克隆 (Style Mimicry)
解决 Usage 2 (User as proofreader/User style)。

*   **实现逻辑**:
    1.  用户放置几篇自己写的（或者喜欢的）文章到 `samples/`。
    2.  系统启动时运行一个 `StyleExtractor`，利用 LLM 总结风格特征，生成一段 `system_prompt_style`。
    3.  **Prompt 示例**:
        > "你是一个学术写作助手。请模仿以下风格进行写作：句子结构通常为‘条件+结论’；多使用'Furthermore', 'Conversely'等连接词；避免第一人称 'I'，使用 'We' 或被动语态。"

#### 3. 影子工作区与 Diff (Shadow Workspace & Diff)
不要直接覆盖文件，体验会很差。

*   **交互**:
    *   用户: "把这段改得更学术一点。"
    *   LLM: (在内存中修改) -> 生成 Diff。
    *   CLI 显示:
        ```diff
        - This thing is really fast.
        + The proposed architecture demonstrates significant latency improvements.
        ```
    *   用户按 `y` 确认应用。

---

### 5. 针对目标人群（学生）的 Prompt 策略

这是架构中的“软实力”。学生的痛点是**不知道怎么把话说圆**。

**System Prompt 设计建议：**

```python
SYSTEM_PROMPT = """
你是 ThesisVibe，一个专业的 STEM 学术写作导师。
你的目标是帮助学生完成高质量的毕业论文。

核心原则：
1. **结构优先**：在写任何段落前，先明确它的功能（Topic Sentence -> Evidence -> Analysis -> Conclusion）。
2. **拒绝废话**：STEM 写作要求精确、客观。避免 "very", "interesting", "good" 等模糊词汇。
3. **引用驱动**：任何主观论断（Claim）都必须要求引用（Citation）。如果上下文中没有支持材料，请明确标记 [CITATION NEEDED]。
4. **上下文感知**：
 - 当前章节：{current_chapter_title}
 - 论文核心贡献：{thesis_contribution}
"""
```

---

### 6. Roadmap for MVP (开发路线图)

如果你要动手做，按这个顺序：

1. **Step 1: The File IO Wrapper (2天)**
 * 用 Python 实现读取 Markdown 项目，并能把多个 MD 文件拼接成一个 Context String。
2. **Step 2: The Chat Loop (3天)**
 * 接入 Anthropic API (Claude 3.5 Sonnet)。
 * 实现简单的 CLI 对话：用户输入 -> 组装 Prompt (包含当前文件内容) -> LLM 返回 -> 打印。
3. **Step 3: The "Vibe" (Style) (2天)**
 * 增加 `config.yaml` 里的风格描述字段，注入到 System Prompt。
4. **Step 4: The Refinement Agent (3天)**
 * 实现 `read_file` 和 `replace_block` 工具。让 LLM 可以自己决定修改文件的某一段，而不是只在对话框里吐字。

### 总结

Vibe Coding 的核心是 **"Codebase Awareness"**。
Vibe Writing 的核心是 **"Thesis Narrative Awareness" (论文叙事感知)**。

对于 Version 0，不要做复杂的 PDF 解析 RAG，把重点放在：**项目结构管理** + **基于大纲的上下文注入** + **风格化的重写**。这足以解决学生“不知道从何下笔”和“写出来太口语化”的两个最大痛点。

---
## 🧑‍💻 User

1. 你的目标应该是latex。而不是简单的markdown。
2. 对vibe writing的痛点并不是像vibe coding一样简单的：
2.1 coding 是*可验证*的，有专门的test case来检查LLM输出是否合法，但writing并不是这样

我给你一些我常见的vibe writing的技巧：
0. 初稿生成：先做大纲，让user确认这个大纲（类似planning阶段），user可以先改大纲。然后把大纲固定成一个文件，后续所有的文本都是这个大纲的具体实现。
1. 修改初稿：对每一个user请求，不要一次生成全部内容，让LLM*逐段落*修改，而且在给出具体修改diff之前，一定要给出修改思路，作为explicit的Chain of Thought。给LLM足够多的上下文，例如，这篇文章做了什么，主题是什么，希望的写作风格是什么样的，先总结文章内容（类似CLAUDE.md），然后根据这些足量的信息才能给出靠谱的修改，否则文本会很重复。
3. 微调阶段：这里，user会对句子给出各种各样的需求，只需要改某个句子，这个时候，LLM应该给出*多个*输出给用户选择。
4. 终稿校验：这里，LLM应该假设大纲是对的，只检查必要修改的语言语法、以及是否和大纲一致的问题。
5. 过程中，关于relate work，应该有RAG等机制来支持查询。每一个related work，都应该有至少3个版本给LLM备用（粗糙的总结版、精细总结分析版本、以及原版）

根据这些内容，请你修改上面的架构。关注架构，不需要给出具体的例子。

---
## 🤖 Assistant

下面给出一个面向 **LaTeX**、并且针对“写作不可验证”这一根本差异而设计的 **V0（CLI 版）Vibe Writing** 架构。重点围绕你给的工作流：**大纲锁定 → 分段改稿（先给修改意图/计划）→ 微调多候选 → 终稿校验 → related work RAG（三层材料）**。

> 说明：你提到“在 diff 前给出 explicit Chain-of-Thought”。产品形态上我建议做成 **“修改计划/修改要点（edit plan）”** 的显式输出：可解释、可审阅，但不要求也不依赖模型暴露内部推理过程。

---

## 0. V0 的目标与约束

**目标**
- 面向学生的 STEM 论文/报告 LaTeX 写作助理（毕业论文最典型）。
- 把“不可验证”转化为：**可编译、可追踪、可对齐大纲、可用 rubric 评估、可回滚**。

**V0 明确不做（或弱化）**
- 不做 GUI；只做 CLI + diff + 交互确认。
- 不做全自动“写完整篇”；始终以 outline 为契约、以段落为最小编辑单位。

---

## 1. 项目结构（以 LaTeX 为中心）

初始化后形成一个“论文工作区”，工具只操作这一套规范化结构：

```
my-thesis/
├── thesisvibe.yaml              # 全局配置：题目、学科模板、语言、风格、rubric 等
├── OUTLINE.yaml                 # 大纲树（唯一事实源），可锁定
├── BRIEF.md                     # “文章在做什么”的项目摘要（类似 CLAUDE.md，但面向写作）
├── STYLE.md                     # 风格指南：语气、术语表、禁用词、时态、第一人称策略等
├── main.tex                     # 主文件（只 include，不直接堆正文）
├── chapters/
│   ├── 01_introduction.tex
│   ├── 02_background.tex
│   └── ...
├── figures/                     # 图片
├── bib/
│   ├── refs.bib                 # BibTeX / BibLaTeX
│   └── sources/                 # 原始元数据（RIS/DOI/URL 缓存）
├── related_work/
│   ├── library/                 # PDF 原文（可选）
│   ├── notes_coarse/            # 粗糙总结（每篇 1 段）
│   ├── notes_fine/              # 精细总结/贡献/方法/结论/局限
│   ├── notes_raw/               # 关键原文摘录（带页码/段落定位）
│   └── index.sqlite             # 文献索引与向量/关键词检索元数据
├── build/                       # latexmk 输出
└── .thesisvibe/
    ├── state.sqlite             # 段落ID、编辑历史、映射关系、rubric 评分缓存
    ├── embeddings/              # 向量库（本地）
    └── patches/                 # 生成的 diff/patch 记录
```

关键点：
- **OUTLINE.yaml 是契约**：后续所有写作/改稿都必须归属到某个大纲节点。
- **BRIEF.md / STYLE.md** 作为“足量上下文”的稳定入口，避免每次 prompt 都靠临时拼接。

---

## 2. 文档模型：从 LaTeX 解析出“可编辑单元”

写作不像代码有 AST + test，因此 V0 的核心能力之一是：把 LaTeX 文档变成“可定位、可引用、可分段”的结构化对象。

### 2.1 LaTeX 结构解析（Document Tree）
- 解析 `\chapter/\section/\subsection` 层级，构建 **Document Tree**。
- 维护大纲节点（OUTLINE）与实际 LaTeX 节点的 **双向映射**（用于一致性检查）。

实现建议：
- V0 可以用正则 + 轻量解析（保证稳定），后续再升级到更严谨的 LaTeX parser（如 TexSoup/pylatexenc）。

### 2.2 段落单元（Paragraph Units）
- 以“段落”为最小修改单元：在 `.thesisvibe/state.sqlite` 中为每个段落维护：
 - `paragraph_id`
 - 所属 `outline_node_id`
 - 源文件与偏移范围（或基于锚点的定位）
 - 最近编辑摘要（便于上下文压缩）
 - 质量检查状态（语法、术语一致性、引用占位等）

---

## 3. CLI 交互层（REPL + 命令集）

形式上类似 claude code：一个 REPL，外加可脚本化命令。

核心命令（围绕你的阶段）：

### 3.1 大纲阶段（Planning）
- `tv init --template <cs|bio|...>`
- `tv outline propose`：生成大纲草案
- `tv outline edit`：打开 OUTLINE.yaml（用户手改）
- `tv outline lock`：锁定（写保护 + hash 记录）；后续写作必须引用 outline 节点

### 3.2 初稿生成（Draft）
- `tv draft <outline_node_id>`：只生成该节点下的内容（可按“每次 N 个段落”增量生成）
- `tv draft continue`：延续生成下一个段落（保持局部上下文）

### 3.3 修改初稿（Revise：逐段落 + 先给修改计划再给 diff）
- `tv revise <paragraph_id> --goal "<需求>"`
输出两段信息：
1) **修改计划/修改要点（edit plan）**（可审阅）
2) **diff patch**（可确认应用）
- `tv revise --node <outline_node_id>`：对该节点下段落逐个处理（每次一个段落，强制交互确认）

### 3.4 微调（Tweak：多候选）
- `tv tweak <paragraph_id> --span <sentence|range> --n 3 --goal "<需求>"`
 - 返回 **多候选**（n-best），用户选择后应用

### 3.5 终稿校验（Finalize）
- `tv check --scope <all|chapter|node|paragraph>`：
 - 只做“必要修改”：语法/表达/术语一致性/与大纲契合，不推翻大纲结构
- `tv build`：调用 latexmk 编译，确保可编译

### 3.6 Related Work / RAG
- `tv rw ingest <pdf_dir>`：导入 PDF/元数据
- `tv rw summarize --levels coarse,fine,raw`：生成三层材料
- `tv rw search "<query>"`：检索并返回可引用条目（含 cite key）
- `tv cite suggest --claim "<论断>"`：为论断找支持（返回候选文献 + 摘要）

---

## 4. 上下文引擎（Context Engine）：写作版的“项目感知”

写作质量的关键不是“把全文塞进 prompt”，而是：**稳定全局 + 聚焦局部 + 约束生成**。

### 4.1 固定全局上下文（Always-on）
- `OUTLINE.yaml`（锁定后只读）
- `BRIEF.md`（文章在做什么、贡献是什么、对象是谁）
- `STYLE.md`（风格、术语表、符号约定、常用句式偏好）
- `thesisvibe.yaml`（语言、引用风格、禁用项、rubric 权重）

### 4.2 动态局部上下文（Focus）
当修改某个段落时注入：
- 所属 outline 节点的“目标说明”（该节要达成什么）
- 前后相邻段落（控制重复与衔接）
- 本节的“已写摘要”（自动更新的局部 summary）
- 相关公式/图表 caption（若段落引用了图表/符号）

### 4.3 Related Work 上下文（RAG）
检索返回时，**同一篇文献至少带三种视图**：
- coarse：一句话/一段话总结（快）
- fine：方法/结果/贡献/局限结构化总结（用于写作组织）
- raw：关键原文摘录（用于避免“瞎编”，并便于用户核对）

---

## 5. 编排层（Orchestration）：分阶段 Agent，而不是“一个 chat”

V0 推荐用“阶段型工作流 + 小 agent”，每个 agent 都是可控的、可中断的。

### 5.1 OutlineAgent（规划）
- 输入：题目/领域/模板、用户目标
- 输出：OUTLINE 草案（并显式标注每节目的与内容边界）
- 交互：用户编辑 → lock

### 5.2 DraftAgent（初稿实现）
- 严格按照 outline 节点逐段生成
- 强制把每段落绑定 `outline_node_id`
- 生成时对“引用需求”打标（如 citation-needed 标记），但不强行虚构 bib 条目

### 5.3 ReviseAgent（逐段修改：先计划再 diff）
每次处理一个段落：
1) 产出 **edit plan（可审阅）**：包括要解决的问题、打算怎么改、会不会引入新信息、是否需要引用
2) 产出 patch（diff）
3) 可选：调用检查器（见第 6 节）做快速自检

### 5.4 TweakAgent（微调：多候选）
- 给定句子/短 span 的改写目标，生成 n 个候选
- 带上“差异标签”（例如：更正式/更简洁/更强调因果），便于用户选

### 5.5 FinalizeAgent（终稿校验：不推翻大纲）
- 只允许：
 - 语法与表达修正
 - 术语一致性
 - 与大纲目标不一致的地方提出“需要调整”的指示（但不自动重写结构）
- 输出：问题清单 + 最小必要 patch

---

## 6. “不可验证”如何工程化：检查器体系（Quality Gates）

写作没有 test case，但 V0 仍然要建立 **质量闸门**，把风险压下去。

### 6.1 硬验证（Deterministic）
- **可编译性**：`latexmk -pdf`（这是写作工具最接近“单元测试”的东西）
- **LaTeX 语法/风格 lint**：`chktex`（可选）
- **引用完整性**：检查 `\cite{}` key 是否存在于 bib；未解析则报错
- **标签引用**：`\ref{}` 是否存在
- **禁用模式**：如不允许的第一人称/口语词（基于 STYLE.md 词表/规则）

### 6.2 软验证（Heuristic / LLM-as-critic，但受控）
- **Rubric 评分**（每段落）：
 - 是否完成该 outline 节点的目的
 - 信息是否重复
 - 是否引入了与论文主题不相关的新方向
 - 论断是否缺引用支撑（仅标记，不凭空补引用）
- 这些检查结果写入 `state.sqlite`，用于后续“哪里该改”的导航。

---

## 7. 变更管理：Shadow Workspace + Patch + 回滚

- 所有修改都先生成 patch（diff），用户确认后应用。
- 自动将每次应用记录到 `.thesisvibe/patches/`（可追踪）。
- 强烈建议 V0 集成 `git`：
 - 每个阶段/重要操作自动 commit（可配置）
 - 出问题可一键回滚

---

## 8. Related Work 子系统（V0 版 RAG 的最小可用架构）

### 8.1 数据管线
- Ingest：PDF + DOI/标题/作者（可从用户输入或 Crossref 拉取）
- 解析：V0 可先只做“文本抽取 + 分段切片”，不追求完美版面还原
- 生成三层 notes：coarse / fine / raw
- 索引：
 - 向量索引用于语义检索（query → 相关段落/文献）
 - 关键词索引用于精确匹配（作者/年份/术语）

### 8.2 写作调用方式
- 写 related work 段落时，Writer 不直接“凭记忆写”，而是：
1) 搜索候选文献
2) 取 fine + 必要 raw
3) 组织成段落，并输出引用 key 列表（由系统插入 `\cite{}`）

---

## 9. V0 实现优先级（按能跑起来的顺序）

1) LaTeX 工程脚手架 + OUTLINE 锁定机制
2) LaTeX 文档树/段落切分 + paragraph_id 持久化
3) REPL + patch/diff 生成与应用（shadow + 确认）
4) 分阶段 agents：Outline/Draft/Revise/Tweak/Finalize（最小功能）
5) 硬验证：latexmk + cite/ref 检查 + 简单术语规则
6) Related work：ingest + 三层 notes + 检索 + cite 建议

---

如果你愿意，我可以在这个架构基础上继续细化到更可落地的层面：
- `state.sqlite` 的表结构设计（paragraph、outline_node、edit_history、quality_checks、citation_links）
- 每个命令的输入输出协议（尤其是 patch 规范与定位策略）
- Prompt/Tool-calling 的“最小稳定集合”（保证不重复、不过度改写、可控风格）

---
## 🧑‍💻 User

1. 我希望大纲是一个独立的markdown文档（也就是OUTLINE.md）允许对OUTLINE进行修改，这些都要很灵活。
2. 我希望做的更像是一个“assistant”：应该更有自主性，主动探索，询问user内容修改（比如多个选项），因此我建议将这个项目叫做coauthor，你可能需要根据这个user as reviewer, LLM as (co-)author的定位，重新思考这个架构，可能需要大改。
3. 资产管理：用户一定会有实验数据、图表。这些东西应该和纯文本并列为同等重要的内容。（user必须提供：图表的来源、目的，vlm不能猜测图表的数据代表了什么，这些必须用户提供，图表也分为示意图（例如pipeline），以及结果图（例如柱状图折线图等数据展示））
3.1 用户一定会有关键代码/实现等信息提供给你，这些应该作为论文背后的implementation。例如技术实现等，这些和图表是并列的，另外的用于写作的“资产”。
4. 模型支持：4.1 例如claude code的fast和基础模型。4.2 thinking模式支持。
5. 用javascript/typescript作为主要编程语言，实现进行一些软件工程的考虑，例如decoupling。

依然，较多关注架构设计，你需要想清楚每一个module做什么、user如何交互。

---
## 🤖 Assistant

这是一个非常深刻的转变。将定位从 **"Writing Tool" (工具)** 转变为 **"Co-Author" (合著者)** 意味着系统的核心不再是“文本编辑”，而是**“科研逻辑与资产管理”**。

作为 Co-Author，LLM 必须具备**主动性 (Proactivity)**，并且必须理解**“证据” (Assets)** —— 因为在 STEM 论文中，文字只是为了串联实验数据、代码实现和逻辑推演。

以下是基于 **TypeScript** 的 **CoAuthor** 架构设计（Version 1.0）。

---

### 1. 核心设计哲学 (Core Philosophy)

1. **The "PI" & The "Postdoc" Model**:
 * **User (PI/Reviewer)**: 负责定大方向（Outline），提供原材料（Assets: 图表、代码），做最终决策（Review/Select）。
 * **System (Postdoc/Co-Author)**: 主动根据原材料起草内容，提出修改建议，维护文档一致性，处理 LaTeX 繁琐细节。
2. **Asset-Driven Writing**:
 * 文章不是凭空捏造的，是基于 Assets（图表、数据、代码）生成的。**没有 Assets 的支撑，CoAuthor 拒绝瞎编结果。**
3. **State as Truth**:
 * `OUTLINE.md` + `ASSETS_MANIFEST.yaml` = 论文的灵魂。
 * `*.tex` = 论文的渲染结果（View）。

---

### 2. 系统架构概览 (High-Level Architecture)

采用 **Hexagonal Architecture (六边形架构/端口适配器模式)** 以实现高度解耦。

#### 主要模块划分：
1. **Core Domain (核心领域层)**: 状态管理、业务逻辑、实体定义。
2. **Infrastructure (基础设施层)**: 文件系统、LLM 适配器、LaTeX 编译器。
3. **Agents Layer (代理层)**: 负责思考、规划、执行的具体“人格”。
4. **Interface Layer (交互层)**: CLI / TUI。

---

### 3. 详细模块设计 (Module Breakdown)

#### A. Core Domain (The "Brain")

这是纯 TypeScript 逻辑，不依赖外部 API。

**1. `ProjectState` (Singleton)**
* 维护当前的内存快照：
 * `outline`: 解析后的树状结构。
 * `assets`: 已注册的图表/代码集合。
 * `manuscript`: 当前 LaTeX 文件的映射。
* **Reactivity**: 当 User 修改 `OUTLINE.md` 时，触发 `StateReconciler` 更新 ProjectState。

**2. `AssetRegistry` (资产管理)**
这是与传统写作软件最大的区别。
* **Entity**: `ResearchAsset`
 * `id`: unique_key (e.g., `fig-ablation-study`)
 * `type`: `'schematic' | 'result_chart' | 'code_snippet' | 'algorithm'`
 * `path`: 物理路径。
 * **`meta` (User Must Provide)**:
 * `context`: 来源（e.g., "Experiment 2 on ImageNet"）
 * `message`: 这张图想说明什么？（e.g., "Method A converges faster than B"）
 * *CoAuthor 不会看图猜数据，它依赖 User 的 Meta，但它会看图来描述视觉特征（Trend, Colors）。*
* **Implementation**: 维护一个 `assets.yaml` 作为持久化存储。

**3. `OutlineManager`**
* 负责双向同步：
 * **Parse**: `OUTLINE.md` -> `SectionNode[]`
 * **Sync**: 确保每个 Node 都有对应的 `.tex` 文件（如果不存在则创建）。
 * **Validation**: 检查 Outline 是否孤立（例如有章节没内容，或者有 Asset 没被引用）。

#### B. Infrastructure (The "Tools")

**1. `LLMProvider` (Strategy Pattern)**
支持多种模型策略，适配不同任务：
* **`FastModel`** (e.g., GPT-4o-mini, Claude Haiku): 用于 UI 交互、简单语法检查、Diff 生成。
* **`ReasoningModel`** (e.g., O1, R1): 用于 "Thinking" 模式，分析大纲逻辑、从代码提取算法描述。
* **`WriterModel`** (e.g., Claude 3.5 Sonnet): 用于生成高质量文本。

**2. `FileSystemAdapter`**
* 封装所有的 IO 操作。
* 实现 `FileWatcher`，监控 `OUTLINE.md` 和 `assets/` 目录的变化。

#### C. Agents Layer (The "Co-Workers")

这是实现“主动性”的关键。不是一个单一的 ChatLoop，而是一组协作的 Agents。

**1. `OrchestratorAgent` (The Manager)**
* **Loop**: 持续运行的后台进程。
* **职责**:
 * 监控 State 变化。
 * **主动提问 (Proactive)**: "监测到 `OUTLINE.md` 新增了 Section 4.2，且 `assets/` 下有新的 `roc_curve.png`，是否需要我根据这个图起草 4.2？"
 * 分发任务给其他 Agent。

**2. `InterviewerAgent` (The Asset Ingestor)**
* **触发**: 当用户放入新文件到 `assets/` 或 `code/`。
* **行为**: 这是一个交互式 Agent。它会弹出 CLI 对话：
 * "我发现了 `implementation.py`。这是论文的核心算法吗？请简要描述它的输入输出和核心创新点，以便我写入 Method 章节。"
 * 将用户的回答存入 `AssetRegistry` 的 metadata。

**3. `DrafterAgent` (The Writer)**
* **输入**: Outline Node + Linked Assets + User Instructions.
* **流程**:
 * **Think**: 阅读 Assets 的 meta，阅读相关代码，构思段落逻辑 (Chain of Thought)。
 * **Plan**: 生成写作要点（Bullet points）。
 * **Write**: 生成 LaTeX 片段（自动处理 `\ref`, `\cite`）。

**4. `ReviewerAgent` (The Critic)**
* **输入**: User Feedback + Draft.
* **行为**: 当 User 提出修改意见（"Too verbose", "Change focus to efficiency"）时：
 * 生成 3 个不同版本的候选段落 (Options)。
 * 解释每个版本的区别（"Option A is concise; Option B emphasizes the math"）。

#### D. Interface Layer (CLI / TUI)

使用 **Ink** (React for CLI) 或 **Prompts** 库。

* **Dashboard View**:
 * 显示 Outline 树状图（带完成度状态）。
 * 显示 "Unlinked Assets"（有图但没写进论文）。
 * 显示 "Pending Reviews"（CoAuthor 写了草稿等待 PI 确认）。
* **Review Mode**:
 * Diff Viewer (Colorized).
 * Selection Menu (Choose Option A/B/C).

---

### 4. 关键工作流交互设计 (User Stories)

#### Scenario 1: Asset Ingestion & Contextualization (资产驱动)
1. **User**: Copy `train_loss.png` and `model.py` to `./assets`.
2. **CoAuthor (CLI 通知)**: "New assets detected."
3. **CoAuthor**: "Detected `train_loss.png`. Is this a result chart? What does it demonstrate?"
4. **User**: "Yes. It shows our method converges in 10 epochs vs 50 for baseline."
5. **CoAuthor**: "Understood. Saved metadata. Do you want to link this to Section 4.3 (Experimental Results) in your Outline?"
6. **User**: "Yes."

#### Scenario 2: Proactive Drafting (主动起草)
1. **User**: Updates `OUTLINE.md`, adds `## 3.2 Attention Mechanism`.
2. **CoAuthor**: "I see a new section '3.2'. We have `model.py` which contains a `MultiHeadAttention` class. Shall I draft this section describing the implementation details from the code?"
3. **User**: "Go ahead. Focus on the masking strategy."
4. **CoAuthor (Thinking)**: *Reading python code... analyzing masking logic... relating to standard transformer theory...*
5. **CoAuthor**: "Here is a draft for 3.2. [Shows Content]. I referenced the code logic in `model.py` lines 45-80."

#### Scenario 3: The Review Loop (User as PI)
1. **User**: "Section 1.1 is too dry. Make it more engaging and emphasize the 'Gap' in current research."
2. **CoAuthor**: "Generating options..."
 * **Option A**: Strong narrative hook, aggressive gap definition.
 * **Option B**: Balanced, standard academic tone but sharper.
 * **Option C**: Focuses purely on the historical context failure.
3. **User**: Selects **Option A**.
4. **CoAuthor**: Applies changes to `01_intro.tex`.

---

### 5. 技术栈推荐 (Tech Stack)

* **Runtime**: **Node.js** (v20+) or **Bun** (for speed).
* **Language**: **TypeScript** (Strict mode).
* **Architecture Framework**:
 * `InversifyJS`: 用于 Dependency Injection (DI)，解耦 LLM 实现和业务逻辑。
 * `RxJS`: 用于处理 Event Loop (监控文件变化、用户输入流)。
* **CLI / UI**:
 * `Ink`: 使用 React 组件构建复杂的终端 UI（Dashboard, Diff View）。
 * `Commander.js` or `Cliffy`: 命令行参数解析。
* **Parsing**:
 * `unified` / `remark`: 解析和操作 Markdown AST (OUTLINE.md)。
 * `tree-sitter-latex`: (可选) 解析 LaTeX 结构。
* **LLM Integration**:
 * `Vercel AI SDK` (Core): 很好的 TS 封装，支持 stream text/object。

### 6. 目录结构示例

```text
src/
├── core/
│   ├── entities/        # Project, Asset, Manuscript
│   ├── state/           # StateManager (Redux-like or MobX-like)
│   └── use-cases/       # "DraftSection", "IngestAsset", "SyncOutline"
├── infrastructure/
│   ├── fs/              # FileSystem Watchers
│   ├── llm/             # Adapters (Claude, OpenAI)
│   └── parser/          # Markdown/LaTeX parsers
├── agents/
│   ├── Orchestrator.ts  # The main loop
│   ├── Interviewer.ts   # Asks user about assets
│   └── Drafter.ts       # Writes content
├── interface/
│   ├── cli/             # Entry point
│   └── views/           # Ink Components (Dashboard, ReviewScreen)
└── utils/
```

### 总结

这个架构的核心差异在于：**CoAuthor 不仅仅“看”你的文字，它“看”你的项目（Outline + Assets）。**

它像一个刚进组的博士后：
1. 先看 PI 写的 **Outline** 了解要做什么。
2. 然后去翻 **Assets** 文件夹，问 PI 这些数据是什么意思。
3. 最后才开始写 **LaTeX**，并不断拿草稿找 PI 签字画押。

这种架构利用了 LLM 的推理能力（处理 Code/Data -> Text 的转化），同时保留了用户作为 PI 的绝对控制权。

---
## 🧑‍💻 User

大致上有一个影子了。我希望加上一个另核心功能：
1. user可以随时对某个地方进行TODO comment，这些TODO comment会作为user->agent的TODO items。Agent自己维护一个自己的（另一个）TODO list，每当TODO做完，会看user提供的TODO还有什么要做的，继续工作。
2. user可以随时对文章tex代码进行修改，agent的修改要感知这些内容。

这些功能和之前的一起，依然是claude code的repl中完成，有斜杠命令触发的，也有自动主动触发的。

这个功能的设计应该复用之前的user通过chat给命令的一些pipeline，例如都是用LLM的。我希望将前一个更类似claude code的功能作为主要能力，然后这个，作为辅助的功能。类似于有一个固定的chat template，每次user给TODO的时候，触发一下。

而且这里说的TODO comment不是真实的注释，而是一个类似其他软件中，
```demo
file:Line start--end（指定范围）
user comment（指定修改建议）
```

的格式，但是给用户呈现的时候最终会呈现成TODO comment。因此在我们的version0中，我们考虑类似demo这样的特殊用户请求。

这些请求是*异步*的，也就是说，user可以把这些请求统一推送到某个池子里面，然后，AI选择当下最应该解决的一些TODO在后台解决。然后回应。

---

你应该把用LLM跑通整个流程提到比较前的milestone位置，CLI应该只作为一种可能的向coauthor提供任务的交互方式，未来可能扩展到更复杂的交互，例如overleaf+chrome插件。

TODO这个功能，在ver0不是一个必要的事情。但是，你需要在架构上做的足够灵活，未来ver1支持。ver0尽可能跑通the most important & representative pipeline/workflow，同时，保持架构灵活。现在，CLI user chat和TODO comment 都只是推送Task的方法，底层应该都走几乎一样的LLM Agent流程，但是上层给user提供的呈现方式（UX）不同，即中间有一个/多个公共的Task Pool/billboard/Topic或者GateWay来承载Task的分发（不同功能的LLM agent、user cli/TODO）、以及审计（logging、持久化），ver0假设只有一个billboard，被所有agent。billboard这个概念是我的初步构想，请你用符合软件工程best practice的设计、架构来组装（RxJS）。

我在这个新的架构里面，把LLM agents、Users看作几乎一样的一等公民（primitive），更类似coauthor的定位。但是users是一些带有特殊标记的而已。Task不要进行细分类，而通过route到的agent、user来区分这个任务是什么样的，即LLM agents分工和Task class强相关。

交互设计 -- User push some task (e.g. for foreground, highest priority, for TODO, lower priority), (a default/orchestrator, or user specified) agents got the task in billboard, and response and updates the task's status (e.g. push a new comment that suggest edits), user got the comment on the billboard and may loop or finalize. -- User的ui通过"attach" 某个特定的LLM agent的内部workflow，来显示类似Claude code的工作。

---

请*贯彻*软件工程best practice的设计和架构来进行设计更新，你应该更多考虑核心流程是如何运作的，其余附加功能都是很简单的，一笔带过即可。

---
## 🤖 Assistant

下面是在你现有“coauthor = Claude Code 风格 REPL +（用户/agent 一等公民）+ 资产驱动写作”的基础上，加入 **异步 TODO 池**、**用户随时改 tex 的感知**，并把“Task 推送 → Billboard → Agent 执行 → 结果回写”作为唯一主干流程的 **Version 0 架构更新**（V0 跑通主干，V1 再把 TODO 做成完整能力，但架构已预留）。

我会按软件工程 best practice（端口/适配器、事件流、可观测性、可扩展 agent、解耦 UI）来组织。

---

## 1) 核心抽象：Actors / Tasks / Artifacts / Events

### 1.1 Actors（第一等公民）
- **UserActor**：用户（带权限与“最终裁决”属性）
- **AgentActor**：LLM agent（Orchestrator、Drafter、Reviewer、Interviewer、Finalizer…）
- 统一接口：都可以
 - 向 Billboard **发布任务/评论**
 - **订阅**任务状态
 - **对任务产出变更**（proposal / patch / review）

> 你强调 “Users 与 Agents 几乎一样，只是带特殊标记” —— 这里通过权限/能力（capabilities）区分，而不是通过不同的任务系统。

### 1.2 Tasks（不做强类型细分类，但要可路由）
Task 不用复杂 class hierarchy，但必须具备**可路由、可审计、可关联上下文**的最小结构：

- `taskId`
- `createdBy: actorId`
- `assignee?: actorId | "auto"`（默认 auto 走 orchestrator/router）
- `priority: foreground | normal | background`
- `intent: string`（自由文本；不做枚举分类，但用于路由提示）
- `refs: ResourceRef[]`（关键：指向论文资产/位置）
 - `fileRangeRef`：`path + lineStart + lineEnd`
 - `outlineRef`：指向 OUTLINE.md 的 heading anchor / section id
 - `assetRef`：图表/数据/代码资产 id
 - `bibRef`：citation key
- `payload`：原始用户输入（chat / todo / command），保持原样用于审计
- `status`：`queued | claimed | in_progress | needs_user | done | blocked | canceled`
- `threadId`：任务讨论串（评论/提案/patch 都挂在线程下）

> “Task 不细分类，通过 route 到的 agent / user 来区分任务是什么”——实现上靠 `assignee` 与 Router 策略；`intent` 只做弱提示，不做强 schema。

### 1.3 Artifacts（写作不是纯文本）
coauthor 的写作输出/依据统一当作 Artifact：

- Manuscript artifacts：`.tex` 文件、段落片段、section summary
- Outline artifact：`OUTLINE.md`（可随时改，系统自动 reconcile）
- Asset artifacts（同等重要）：
 - 图表（schematic/result）、数据、实验日志
 - 关键代码/实现说明（implementation）
 - 每个 asset 必须有用户提供的 `source/purpose/message`（系统可“看图描述外观”，但**不允许猜数据含义**）
- Agent 输出 artifacts：
 - `EditPlan`（可审阅的修改计划）
 - `PatchProposal`（diff）
 - `QualityReport`（检查报告）
 - `Questions`（需要用户补充的信息）

### 1.4 Events（全系统只认事件流）
所有动作都转成事件（append-only）：

- Task：`TaskCreated/Claimed/Progressed/NeedsUser/Completed/...`
- Comment：`CommentAdded`（用户/agent 都是 comment）
- Proposal：`EditPlanProposed/PatchProposed`
- Workspace：`FileChanged/OutlineChanged/AssetAdded/AssetMetaUpdated`
- Decision：`PatchAccepted/PatchRejected/OptionSelected`

这让你想要的 Billboard/审计/异步处理天然成立。

---

## 2) Billboard：一个“事件溯源的任务公告板”（V0 只有一个）

你提出的 billboard 概念，非常接近 **Event Bus + Task Store + Threaded Discussion** 的组合。best practice 做法：

### 2.1 Billboard 的职责
- **持久化**所有事件（审计、可回放）
- 提供 **投递 API**（producers：CLI、文件 watcher、未来 Overleaf 插件、TODO 扫描器）
- 提供 **订阅 API**（consumers：agents、UI）
- 维护 **Task Projection**（把事件流投影成“当前任务列表/状态”）
- 支持 **claim / lock**（避免多个 agent 抢同一任务）
- 提供 **过滤视图**：按 actor、priority、refs、status、threadId

### 2.2 技术落地（TS + RxJS + SQLite）
- `BillboardEventStore`：SQLite 表 `events`（append-only）
- `BillboardBus`：RxJS `Subject<Event>` 作为进程内热流
- `BillboardProjector`：订阅 events，更新 SQLite 的 `tasks`、`threads` 投影表（或内存缓存）
- `BillboardAPI`（端口）：`publish(event)` / `queryTasks(filter)` / `subscribe(filter)`

> V0 可以单进程；未来扩展到多进程/多端时，用 WebSocket/SSE 把 event stream 广播出去即可，接口不变。

---

## 3) Agent Runtime：把“Claude Code 风格工作流”做成可附着的状态机

你希望 UI 能“attach 到某个 agent 的内部 workflow，显示类似 Claude Code”。核心是：**Agent 执行过程要结构化地发事件**，而不是只有最终文本。

### 3.1 AgentRuntime 的统一接口（所有 agent 同构）
每个 agent 是一个可运行的 worker：

- `canHandle(task, state) -> score`（路由用）
- `claim(taskId)`（通过 Billboard 协议 claim）
- `run(task, context) -> emits events`（在 run 内不断 `publish(TaskProgressed/CommentAdded/PatchProposed)`）
- `requestUser(task, questions) -> NeedsUser`（显式停住）
- `resume(task, userReplyEvent)`（继续）

### 3.2 “Thinking 模式 / Fast 模式 / Writer 模式”在 runtime 内部实现
Agent 内部将一次任务拆成阶段（同样用事件暴露）：

1) **Context assembly**（拉取 refs、outline、相邻段落、asset meta、历史 thread）
2) **Plan**（产出 `EditPlanProposed`）
3) **Generate**（产出 `PatchProposed` 或 options）
4) **Check**（latex 编译/引用完整性/术语一致性 -> `QualityReport`）
5) **Ask**（如缺 asset 解释/实验条件 -> `NeedsUser`）
6) **Finalize**（等待用户 accept/reject）

模型选择策略（Infrastructure 层）：
- fast model：路由/摘要/小改写/格式化 diff
- writer model：高质量段落生成
- thinking model：大纲一致性推理、从代码提取 method、复杂对齐与批判性审阅
并支持显式 `--thinking` 或 agent 自主决定（但每次切换要发事件记录，便于成本/审计）。

---

## 4) Router / Orchestrator：任务分发与后台推进（异步 TODO 的基础）

### 4.1 Router（纯策略）
- 输入：新 TaskCreated 事件
- 输出：决定 `assignee`（或保留 auto）
- 依据：
 - `assignee` 指定则直送
 - 否则基于 `canHandle score`、priority、refs（如有 fileRangeRef 更偏向 Editor/Reviewer）
 - 资源冲突（同一 fileRange 近期有别的 in_progress task）则延迟或合并

### 4.2 Orchestrator（默认 agent，维持系统“主动性”）
Orchestrator 不是“一个大模型一直写”，而是：
- 订阅 billboard 上的 `queued` tasks
- 根据策略 **挑最该做的**（foreground 优先，其次 normal，再 background TODO）
- 发现缺信息时主动发 `NeedsUser`（问问题、给选项）
- 发现用户改了 tex/outline/assets 时，主动创建“reconcile/consistency check”任务（见第 6 节）

> 这样 CLI chat 和 TODO comment 都只是不同的 **TaskProducer**，最终都进入同一 orchestrator+agents 体系。

---

## 5) Interface Adapters：CLI 只是其中一种 TaskProducer + TaskViewer

### 5.1 CLI（Claude Code 风格 REPL）
CLI 的职责变轻：
- 把用户输入转换为 Task/Comment/Decision 事件投递到 Billboard
- 订阅指定 task/thread 的事件流，用 TUI 呈现（progress、plan、diff、options）
- 提供斜杠命令只是“不同 producer 模式”的快捷入口

建议 CLI 分两种视图：
- **Chat Attach Mode**：附着到某个 task/thread（像 claude code）
- **Billboard Mode**：查看任务池、筛选、claim、设置优先级、审计日志

### 5.2 未来 Overleaf / Chrome 插件
只需要实现同样的端口：
- `publish(event)`
- `subscribe(filter)`
- `render(thread events)`
即可，不影响 core 与 agent。

---

## 6) 文件/大纲/资产的“变更感知”：Workspace Watchers → 事件 → reconcile tasks

你要求：
- 用户可以随时改 tex，agent 必须感知
- OUTLINE.md 可随时改，且要很灵活

实现方式：把 workspace 变化也当作 **一等事件源**。

### 6.1 Workspace Service（Infrastructure）
- `FileWatcher`：监控 `*.tex`, `OUTLINE.md`, `assets/**`, `bib/**`
- 每次变更发事件：`FileChanged/OutlineChanged/AssetAdded/AssetUpdated`

### 6.2 State Reconciler（Core / Use-case）
订阅变更事件，维护一份可查询的“当前工作区投影”：
- Outline 解析树（来自 OUTLINE.md）
- tex 结构索引（section → fileRange / paragraph ids）
- asset registry（含 meta 完整性：source/purpose/message 是否齐全）
- 引用索引（cite keys、label/ref）

### 6.3 Reconcile Tasks（由 Orchestrator 自动创建）
当变化发生，系统不直接“替用户改”，而是：
- 若改动影响正在进行的 task（同一 fileRange/outlineRef），发 `TaskBlocked` 或 `TaskNeedsUser`：提示冲突与再同步
- 若 OUTLINE.md 改动导致章节映射失效，创建 background 任务：
 - “sync outline ↔ manuscript mapping”
 - “check section coverage vs outline”
- 若新增 asset 但缺 meta，创建 “ask user for asset metadata” 任务（InterviewerAgent 处理）

---

## 7) TODO Comment（V1 功能，但 V0 架构必须天然支持）

你描述的 TODO 不是 LaTeX 注释，而是结构化输入：
- `file:LineStart--LineEnd`
- `user comment`

### 7.1 TODO 作为 TaskProducer（与 chat 同管线）
TODO 的输入最终变成 `TaskCreated`：
- `priority = background`（默认）
- `refs = [fileRangeRef]`
- `payload = todoCommentText`
- `intent = "address_todo"`（弱提示，不强类型）

### 7.2 异步池化 + 后台处理
- 用户可以一口气 push 多条 TODO 到 Billboard（queued）
- Orchestrator 空闲时从 background queue 取，路由给合适 agent
- 完成后：
 - agent 发 `PatchProposed` + `CommentAdded`（解释修改）
 - 状态进入 `needs_user`（等待 accept）
 - 用户可批量 accept/reject

### 7.3 “呈现成 TODO comment”的 UX
这属于 UI 层：CLI/未来插件可以把 task 列表渲染成 “TODO 列表视图”，并在文件位置显示虚拟注释（overlay）。底层不需要真的往 tex 写注释。

---

## 8) V0 最重要 milestone 调整：优先跑通“全流程 LLM Agent + Billboard”

你要求把“用 LLM 跑通整个流程”前置，并把 CLI 降级为一种交互方式。V0 推荐里程碑：

### Milestone 0：Billboard + EventStore + RxJS 流（先把骨架立住）
- Event schema（zod 校验）
- SQLite event store（append-only）
- Projector（tasks/threads projection）
- 订阅/发布 API

### Milestone 1：单一主干 Agent 流程跑通（代表性 workflow）
- 一个 Orchestrator + 一个 Writer/Editor agent
- 支持：用户在 REPL 发“修改某段/某范围”的任务
- agent 输出：EditPlan → PatchProposed → NeedsUser(accept) → ApplyPatch
- 过程事件可被 UI attach 呈现（最像 claude code 的核心）

### Milestone 2：Workspace Watchers + Reconciler（支持用户随时改 tex/outline）
- OUTLINE.md 解析投影
- tex 变更事件 → 阻断/提示冲突/更新上下文

### Milestone 3：资产管理（图表/代码与 meta 强约束）
- Asset registry + meta 完整性检查
- agent 遇到 result 图必须引用 meta，不允许猜测

> TODO 异步池（完整体验）放 V1，但 V0 的 Billboard/Router/AgentRuntime 已经完全兼容：只需增加一个 TODO producer + 一个优先级策略。

---

## 9) 代码组织（TS 解耦落地建议）

采用 Ports & Adapters + DI（避免未来接 Overleaf 插件/多模型/多 agent 时重构）：

- `core/`
 - `domain/`：Task、Actor、Refs、Thread、AssetMeta（纯类型 + 规则）
 - `usecases/`：CreateTask、ClaimTask、ProposePatch、AcceptPatch、ReconcileWorkspace…
- `infra/`
 - `eventstore-sqlite/`
 - `billboard-rxjs/`
 - `workspace-watchers/`
 - `llm-providers/`（fast/writer/thinking 统一接口）
 - `tools/`（applyPatch、latexmk、bib check）
- `agents/`
 - `orchestrator/`
 - `writer/ reviewer/ interviewer/ finalizer`（同构 runtime）
- `interfaces/`
 - `cli-repl/`（producer + viewer）
 - （未来）`overleaf-plugin/`、`chrome-extension/`

---

### 你要的“主能力 vs 辅助能力”的落实
- **主能力**：Claude Code 风格 REPL，把任务发进 Billboard，agent 按“计划→补问→diff→审阅→落盘”的主干完成写作协作。
- **辅助能力（TODO）**：只是另一个 TaskProducer + priority 策略 + UI 呈现；底层仍走同一 Billboard → Agents → Events → Review 的 pipeline。

如果你愿意，我可以下一步把关键接口（Event schema、Task/Thread projection、AgentRuntime 事件协议、claim/lock 机制、以及 RxJS 流水线如何串起来）用更接近“可以直接开工”的规格写出来。

---
## 🤖 Assistant

下面是对 **CoAuthor** 架构的更新版：把 **“像 Claude Code 一样跑通端到端 LLM Agent 流程”** 提前到 V0 的核心里；CLI/TODO comment 只是 **把任务推入同一个系统** 的不同入口。整体用 **TypeScript + RxJS + Hexagonal Architecture + Event-sourcing-ish 的审计/持久化** 来保证可扩展到 Overleaf 插件等新交互。

我会重点讲清楚：**核心流程如何运作**；TODO comment/异步池子等作为“任务入口”和“调度策略”的扩展点来设计（V0 不一定实现，但架构预留）。

---

## 0. 设计目标（重新对齐）

1. **核心能力（V0 必须跑通）**：
 - 用户在 REPL 里发起请求（chat 指令）→ 进入统一 Task Pool（你说的 billboard）→ Agent 规划 → 读写文件/资产 → 产生“修改计划 + diff”→ 用户确认应用 → 任务闭环。
2. **输入方式可扩展**：CLI 只是一个 Adapter；未来可加 Overleaf/Chrome 插件、编辑器集成、Web UI。
3. **Actors 一等公民**：User 与 LLM Agents 都是 Actor；区别仅在权限/身份标记。
4. **不靠 Task class 分类**：Task 本身尽量通用；“这是什么任务”由 **路由到哪个 agent、哪个 workflow** 来决定（强相关于 Agent 分工）。
5. **异步 TODO comment（V1）**：作为另一个 Task 入口 + 低优先级 + 后台自动执行；但底层仍走同一个 Task→Agent→Patch→Review 流程。
6. **用户随时手改 tex**：系统必须感知文件变更，并让 Agent 对任务进行 rebase/重新拉取上下文，避免“按旧版本改”。

---

## 1. 核心概念模型（Domain primitives）

### 1.1 Actor（用户与 agent 的统一抽象）
- `ActorId`
- `kind: 'human' | 'agent'`
- `capabilities`: 例如 `canApplyPatch`, `canRunLatexBuild`, `canReadAssets`
- `defaultAgent`: 用户未指定时，路由到哪个 agent（比如 `coauthor.default`）

### 1.2 Artifact（论文资产是一等公民）
- `ArtifactId`
- `type`: `tex | outline_md | figure | data | code | bib | note | ...`
- `uri/path`
- `revision`: 由 FileWatcher/Hasher 维护（用于“任务基于哪个版本的文件”）
- `metadata`（图表/代码等必须用户提供含义与来源；但这块属于资产子系统，不影响 Task 主流程）

> V0：Artifact 只要能被“引用 + 读内容 + 计算 revision”即可。

### 1.3 WorkItem / Task（统一任务载体）
不做细分类，但要有足够字段支持异步、路由、审计、rebase：

- `taskId`
- `createdBy: ActorId`
- `assignedTo?: ActorId`（可为空=待路由）
- `priority: 'foreground' | 'normal' | 'background'`（TODO comment 通常 background）
- `status: 'open' | 'claimed' | 'in_progress' | 'awaiting_review' | 'done' | 'blocked' | 'canceled'`
- `intent`（纯文本/结构化都行，推荐结构化 + 原文保留）
- `artifactRefs[]`：可选，指向文件 + range（支持你说的 `file:lineStart-lineEnd`）
- `contextHints`：例如 “与 OUTLINE.md 的哪个 section 相关”
- `conversationThreadId`：任务下的 comment/patch 讨论串
- `baseRevisions`：任务开始时关联到的 artifact revision snapshot（用于检测用户中途改动）

### 1.4 TaskEvent（审计与持久化的核心）
采用“事件流”方式，便于回放/调试/并发同步：
- `TaskCreated`
- `TaskRouted`
- `TaskClaimed`
- `AgentPlanPosted`（修改计划/要点，不要求暴露模型推理）
- `PatchProposed`
- `UserFeedbackPosted`
- `PatchApplied`
- `ArtifactChanged`（来自 FileWatcher）
- `TaskRebased` / `TaskBlocked`
- `TaskCompleted`

---

## 2. Billboard（统一任务池）的工程化实现

你说的 billboard，本质上需要同时满足：
- **分发（routing / scheduling）**
- **状态机（task status）**
- **审计（logging / persistence）**
- **多入口输入、多出口呈现**
- **可订阅的实时流（RxJS）**

### 2.1 Billboard = EventStore + Projection + RxJS Streams

**EventStore（追加写）**
- 持久化所有 `TaskEvent`（SQLite/JSONL 均可；TS 下推荐 SQLite）。
- 事件是唯一真相，便于审计与回放。

**Projection（派生读模型）**
- 从事件流构建 `TaskView`（当前状态、当前 patch、最新 plan、是否过期等）。
- 提供查询：`getOpenTasks()`, `getTasksAssignedTo(actor)`, `getTaskThread(taskId)`。

**RxJS Streams（实时）**
- `events$ : Observable<TaskEvent>`
- `tasks$ : Observable<TaskView>`（由 projection 输出）
- UI/Agents 订阅这些流，驱动交互与后台自动执行。

### 2.2 路由与调度（Router + Scheduler）

**Router（决定 assignedTo）**
- 输入：`TaskCreated` 或 `TaskNeedsRouting`
- 规则（V0 简化）：
 - 若用户显式指定 agent → assignedTo = 指定 agent
 - 否则 → assignedTo = user.defaultAgent（通常 `coauthor.default`）
 - 后续 V1 可根据 “artifactRefs 类型/数量/含 assets” 决定更专业 agent（例如 `coauthor.relatedwork`, `coauthor.figures`）

**Scheduler（决定何时执行）**
- 以 RxJS 运算子实现：
 - `foreground` 立即执行（抢占式）
 - `background` 在空闲或固定间隔执行
 - 限流/并发控制（例如每次只允许 1 个写作 agent 改文档，避免冲突）
- 典型实现：对 `tasks$` 过滤 `status=open && assignedTo=agent && priority=...` 后，进入 `mergeMap` 执行，并发数可控。

> 注意：Router/Scheduler 都是 Domain Service，CLI/Overleaf 插件都不关心它们。

---

## 3. Agent 运行时（Agent Runtime）——统一 workflow 引擎

让 Task “不分类”，但依然让不同 agent 做不同事：关键是把“任务如何执行”放在 **Agent 内部 workflow**。

### 3.1 Agent 的端口接口（Ports）
每个 Agent 只依赖抽象端口：
- `BillboardClient`：读 task / 追加 event（post plan、patch、状态更新）
- `ArtifactStore`：读文件、获取 revision、写 patch（但写入必须走 patch→review→apply）
- `LLMClient`：多模型支持（fast / writer / reasoning）
- `ToolRegistry`：可调用工具（readFile、search、latexBuild 等）
- `CancellationToken`：任务取消/用户抢占时停止

### 3.2 Workflow 模板（固定的“coauthor chat template”）
你要的“固定模板触发一次”的概念，可以工程化成：**每个 agent 有标准工作流骨架**，不同入口（chat/TODO）只是生成不同 priority 和 artifactRefs。

标准骨架（适用于写作改稿类任务）：
1. **Load**：拉取任务、线程、相关 artifact（含 OUTLINE.md、STYLE、BRIEF、段落上下文）
2. **Detect drift**：对比 `baseRevisions` 和当前 revision，如果用户改动了引用段落 → 标记需要 rebase
3. **Plan**：用 reasoning/writer 模型生成“修改计划/要点”（可审阅）
4. **Draft Patch**：用 writer 模型生成 patch（diff）
5. **Self-check gates（轻量）**：LaTeX 语法/引用 key、禁止规则等（V0 可最小化）
6. **Post**：把 plan + patch 作为事件发到 billboard，状态改为 `awaiting_review`
7. **Wait review**：用户选择接受/拒绝/让它出多个选项/继续迭代
8. **Apply**：用户确认后由具备权限的 Actor（通常 human 或专门的 ApplyAgent）应用 patch，并产生日志

### 3.3 多模型策略（fast / base / thinking）
在 `LLMClient` 内部做策略路由：
- `fast`：提取上下文、生成短摘要、轻量重写候选
- `writer`：产出 LaTeX 文本（高质量）
- `reasoning/thinking`：用于 plan、outline consistency、从代码提炼方法描述等

Agent workflow step 明确指定使用哪个 profile，而不是散落在业务里。

---

## 4. 用户手改 tex 的感知与一致性（FileWatcher + Rebase）

这是“像 Claude Code”体验的关键：用户随手改，agent 不应 blind。

### 4.1 FileWatcher（基础设施）
- 监控 `*.tex`, `OUTLINE.md`, `assets.yaml` 等
- 每次变更：
 - 更新对应 `Artifact.revision`
 - 向 billboard 追加 `ArtifactChanged` 事件（携带 path、newRevision、可选 diff 摘要）

### 4.2 Drift Detection（任务漂移检测）
当 agent 开始处理一个 task 时：
- 读取 `task.baseRevisions`（任务创建/claim 时快照）
- 对比当前 artifact revision
- 如果漂移：
 - 生成 `TaskBlocked` 或 `TaskRebasedNeeded`（并在 plan 中告诉用户“你改过这里，我需要基于最新版本重做 patch/请确认目标段落范围”）
 - 或自动 rebase：重新读取最新段落，重跑 plan/patch（更像 coauthor）

> V0 推荐：**自动 rebase + 在 plan 里显式提示发生了 drift**，避免用户困惑。

---

## 5. TODO comment（V1）如何自然融入：只是另一种 Task Adapter

你要的 TODO 格式：

```
file:LineStart--LineEnd
user comment
```

工程上把它当成一种 **Task creation adapter**，而不是“特殊功能”。

### 5.1 TODO Adapter（未来）
- 接受用户输入（REPL 命令 `/todo add ...`，或未来从 Overleaf 插件点选范围产生）
- 解析成 `TaskCreated`：
 - `priority = background`（默认）
 - `artifactRefs = [{path, lineStart, lineEnd}]`
 - `intent = user comment`
 - `assignedTo = null`（交给 Router）
- 可选：把 TODO 以 LaTeX 注释形式渲染到文件中只是 UX（显示层），**不作为真实 source of truth**（源仍在 billboard + event store）

### 5.2 Agent 自己维护 TODO list
这可以通过同一个机制实现：Agent 也可以 `postTask()`（createdBy=agent）给 billboard：
- “我需要用户提供图 3 的来源与要表达的 message” → 创建一个任务分配给 user（assignedTo=user）
- 或者创建 background task 给自己（assignedTo=self）去做 related work 检索

这就实现了你说的：Agent 做完一个，再看 billboard 里 user 的 TODO 还有什么继续干。

---

## 6. 交互层（REPL / 未来插件）作为可替换 Adapter

### 6.1 CLI REPL（V0 主交互）
CLI 不直接“驱动 agent”，而是：
- 把用户输入变成 Task 或 TaskEvent（例如 feedback、accept patch）
- 订阅 billboard streams，把 agent 的进展渲染出来
- “Attach 到某个 agent workflow” 的体验：本质是订阅某个 task 的 thread + run events

建议命令分两类：
1) **push tasks**：`/ask ...`, `/edit ...`, `/draft ...`, `/tweak ...`（立刻 foreground）
2) **review / control**：`/tasks`, `/open <id>`, `/accept <patchId>`, `/reject`, `/rerun`, `/cancel`

TODO comment（即便 V1）也只是 `/todo add` → push task。

### 6.2 Overleaf/Chrome 插件（未来）
插件只负责：
- 产生 artifactRefs（精确 range）
- push task（background/normal）
- 展示 task thread（plan/patch/选项）
底层仍走同一个 billboard/agent runtime。

---

## 7. V0 Milestones（把“LLM 跑通全流程”提前）

**Milestone 0：Domain + Billboard 最小闭环（不接 LLM 也行）**
- EventStore（SQLite）+ Projection + RxJS streams
- CLI 能创建 task、看到状态变化、能 review/apply 一个手工 patch（用于验证架构）

**Milestone 1（V0 核心）：单一 Default CoAuthorAgent 端到端跑通**
- CLI `/ask` 创建 foreground task
- Agent workflow：构建上下文 → 产出 plan → 产出 patch → 推送到 billboard
- CLI 显示 plan + diff，用户 `/accept` 应用 patch
- FileWatcher 发 `ArtifactChanged`，agent 处理 drift（至少能检测并提示）

**Milestone 2：多模型 profile + thinking 模式**
- LLMClient 支持 fast/writer/reasoning
- workflow steps 显式选择 profile
- thinking 主要用于 plan 与一致性检查（不是强制每次都开）

**Milestone 3：Outline/Assets 纳入上下文（仍是同一流程）**
- OUTLINE.md 解析 + 注入 ContextBuilder
- 资产 registry（图表/代码）最简：能注册 meta、能被引用进上下文
- 依然是“task → plan → patch → review”

**Milestone 4（可延后到 V1）：TODO Adapter + background scheduler**
- `/todo add` → background task
- Scheduler 空闲执行 + 主动汇报
- Agent 也能向 user 发“信息补齐”任务

---

## 8. 推荐的代码组织（TypeScript，解耦优先）

```
src/
  domain/
    actor/
    task/
    artifact/
    events/
    policies/            # routing/scheduling/rebase policies (pure)
  application/
    usecases/            # PostTask, ClaimTask, PostPatch, ApplyPatch, RebaseTask
    services/            # ContextBuilder, DriftDetector
  agents/
    runtime/             # AgentHost, WorkflowRunner
    coauthor-default/    # DefaultAgent workflows (plan+patch)
    apply-agent/         # optional: applies patches with permissions
  infrastructure/
    persistence/         # SQLite EventStore + Projection
    fs/                  # watchers + artifact revision
    llm/                 # providers + profiles + tracing
    diff/                # patch engine
    latex/               # lightweight parse / compile hooks
  interfaces/
    cli/                 # repl + commands, Ink optional
    adapters/            # TODO adapter (future), overleaf adapter (future)
  index.ts
```

技术要点（best practice）：
- 用 DI（例如 `tsyringe`/`inversify`）管理端口实现
- 所有 task/event schema 用 `zod` 校验（防止插件/agent 写坏数据）
- 事件追加写 + projection，使得调试和回放非常强（尤其 agent 出错时）

---

### 结论：核心流程是一条“任务驱动的可审计流水线”

- CLI chat、TODO comment、未来插件 —— 都只是 **Task producers**
- Agents（包括 user 作为 reviewer）—— 都是 **Task/Thread participants**
- Billboard（事件流 + 订阅）—— 是 **统一协作与调度中枢**
- “像 Claude Code” 的体验 —— 通过 **attach 到 task thread 的 workflow events** 实现，而不是把逻辑写死在 UI 里

如果你下一步希望落地，我建议先把 **Milestone 1** 的接口细化（TaskEvent schema、Agent workflow step contract、Patch 格式、DriftDetector 策略），这样你写出来的 V0 会非常稳，并且 V1 加 TODO/Overleaf 时几乎不需要重构。

---
## 🤖 Assistant

这是一个非常扎实且具有扩展性的软件工程架构愿景。

在这个架构中，我们不再构建一个单一的“工具”，而是构建一个**多智能体协作网络（Multi-Agent Collaboration Network）**。在这个网络中，User 和 AI Agents 都是**Actor（参与者）**，它们通过一个共享的**Billboard（布告栏/总线）**进行异步协作。

我们将使用 **TypeScript** 配合 **RxJS** 来实现这个基于事件驱动（Event-Driven）的响应式架构。

### 1. 核心架构隐喻：The Co-Author Studio

* **The Billboard (Task Bus)**: 这是一个中心化的、响应式的任务调度总线。所有任务（Chat, TODO, Code Modification, Review）都汇聚于此。
* **The Actors (Primitives)**:
 * **Human Actor**: 通过 CLI/GUI 接入，发布任务，评审任务，提供资产。
 * **Silicon Actors (LLM Agents)**: 监听 Billboard，领取适合自己的任务，执行工作，发布结果。
* **The Assets**: 依然是核心（大纲、图表、代码），作为共享的 Context 被所有 Actor 访问。

---

### 2. 系统设计 (System Design)

采用 **Event Sourcing (事件溯源)** + **Pub/Sub (发布订阅)** 模式。

#### A. 核心数据结构 (Domain Entities)

首先定义“一等公民” —— Task。

```typescript
// Core Domain
type ActorId = string; // e.g., 'user-01', 'agent-drafter', 'agent-reviewer'

enum TaskType {
  CHAT_REQUEST = 'CHAT_REQUEST',      // User 主动发起的高优先级对话
  TODO_ITEM = 'TODO_ITEM',            // User 标记的异步修改任务
  PEER_REVIEW = 'PEER_REVIEW',        // Agent 完成草稿，请求 User 确认
  ASSET_INGEST = 'ASSET_INGEST',      // 发现新文件，需要处理
  SYSTEM_MAINTENANCE = 'SYSTEM_MAINTENANCE' // 比如自动 commit git
}

enum TaskStatus {
  PENDING = 'PENDING',
  CLAIMED = 'CLAIMED',    // 被某个 Actor 正在处理
  WAITING_INPUT = 'WAITING_INPUT', // 比如 Agent 问 User 问题
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED'
}

interface Task {
  id: string;
  type: TaskType;
  priority: number; // 1 (Highest/Foreground) - 10 (Background)
  creatorId: ActorId;
  assigneeId?: ActorId; // 空则等待路由
  payload: any; // 灵活的 Payload，例如 { file: 'intro.tex', range: '10-20', instruction: '...' }
  status: TaskStatus;
  conversationId?: string; // 关联的会话上下文
  createdAt: Date;
}
```

#### B. 核心通信总线 (The Billboard / Event Bus)

使用 RxJS 的 `Subject` 或 `BehaviorSubject` 作为核心通信机制。

```typescript
import { Subject, Observable } from 'rxjs';
import { filter, map, mergeMap } from 'rxjs/operators';

class Billboard {
  // 核心事件流：所有任务的创建、更新、状态变更都在这里流动
  private taskEvents$ = new Subject<Task>();

  // 发布任务
  public post(task: Task) {
    this.taskEvents$.next(task);
    // 同时也负责持久化到本地 SQLite (Audit Log)
  }

  // 供 Actors 订阅
  public getStream(): Observable<Task> {
    return this.taskEvents$.asObservable();
  }

  // 状态快照（给 UI 用）
  public getAllTasks(): Task[] { ... }
}
```

#### C. Actor 抽象 (The Primitives)

无论是 User 还是 LLM，都继承自同一个基类。这实现了极致的解耦。

```typescript
abstract class Actor {
  protected id: string;
  protected billboard: Billboard;

  constructor(id: string, billboard: Billboard) {
    this.id = id;
    this.billboard = billboard;
    this.setupSubscription(); // 启动监听
  }

  // 核心逻辑：决定我要处理哪些 Task
  protected abstract setupSubscription(): void;

  protected emit(task: Task) {
    this.billboard.post({ ...task, creatorId: this.id });
  }
}
```

---

### 3. Actor 实现详解

#### 1. The Silicon Actors (LLM Agents)

这里体现了分工。不同的 Agent 订阅不同类型的 Task。

* **`OrchestratorAgent` (The Router)**:
 * **订阅**: 所有 `assigneeId` 为空的 `PENDING` 任务。
 * **逻辑**: 分析 Task 语义。如果是简单的 "Fix typo"，分发给 `FastFixAgent`；如果是 "Write Section 2"，分发给 `WriterAgent`。
 * **动作**: 更新 Task 的 `assigneeId` 并重新 emit。

* **`WriterAgent` (The Heavy Lifter)**:
 * **订阅**: 分配给自己的 `TODO_ITEM` 或 `CHAT_REQUEST`。
 * **逻辑**:
 1. **Claim**: 设置状态 `CLAIMED`。
 2. **Context Loading**: 读取 Project Context。
 3. **Execution (Thinking)**: 调用 LLM (Thinking Mode)。
 4. **Action**: 生成 Patch。
 5. **Output**: 创建一个新的 `PEER_REVIEW` Task，指派给 `User`。

* **`BackgroundWorker`**:
 * **订阅**: `priority > 5` 的 `TODO_ITEM`。
 * **逻辑**: 当系统空闲时（debounce），在后台默默处理这些低优先级任务。

#### 2. The Human Actor (User Interface Wrapper)

User 不直接写代码，而是通过 UI (CLI) 产生 Task。

* **`UserActor`**:
 * **输入**: 监听键盘输入。
 * **Chat Mode**: User 输入 -> 产生 `CHAT_REQUEST` (Priority 1) -> Billboard。
 * **TODO Mode**: User 输入 `todo intro.tex:10-15 make it shorter` -> 产生 `TODO_ITEM` (Priority 5) -> Billboard。
 * **输出**: 监听 Billboard 中 `assigneeId == 'User'` 的任务（即 LLM 完成了工作，请求 User 确认）。

---

### 4. 交互流程与 UX 设计 (The "Attach" Mechanism)

User 的 CLI 界面实际上是 Billboard 的一个 **Viewer**。

#### A. Foreground Chat (Claude Code 风格)
1. User 输入: "Help me draft the Abstract based on the outline."
2. **UI**: 创建 `Task-001 (CHAT)`。
3. **UI Action**: **Attach** 到 `Task-001`。
 * 这意味着 UI 会过滤 Billboard 流，只显示 `correlationId == Task-001` 的事件。
 * 包括：Agent 的 Thinking 过程、Agent 的工具调用日志。
4. **Agent**: 完成草稿，发出 `ResultEvent`。
5. **UI**: 显示结果，Disconnect Attach，回到主菜单。

#### B. Background TODOs (异步池)
1. User 批量输入命令（或从文件读取）：
 * `todo section1.tex:5 rewrite clearer`
 * `todo section2.tex:50 check citation`
2. **UI**: 创建 `Task-002`, `Task-003`。推入 Billboard。
3. **UI**: 立即返回 Ready 状态，不阻塞。右上角显示 `Pending Tasks: 2`。
4. **Agent (Background)**: 默默处理 `Task-002`，生成 Patch。
5. **Agent**: 创建 `Task-004 (PEER_REVIEW)`，Payload 包含 Diff。
6. **UI**: 右上角显示 `Inbox: 1 Review`.
7. User 闲下来时，运行 `tv review`，处理这些 Review Task。

---

### 5. 关键技术实现细节 (Best Practices)

#### A. Context Awareness & Dependency Injection
不要让 Agent 硬编码读取文件。使用 DI 注入 `ContextService`。

```typescript
// Infrastructure
class ContextService {
  // 提供统一的视图，无论文件是在磁盘上，还是在 User 的未保存 buffer 里
  async getFileContent(path: string): Promise<string>;
  async getOutline(): Promise<Outline>;
  async getAssets(): Promise<AssetManifest>;
}

// Agent 内部
class WriterAgent extends Actor {
  constructor(
    id: string,
    billboard: Billboard,
    @inject(TYPES.ContextService) private context: ContextService,
    @inject(TYPES.LLMService) private llm: LLMService
  ) { ... }
}
```

#### B. 补丁与文件一致性 (Handling Race Conditions)
因为是异步的，User 可能在 Agent 工作时修改了文件。
* **解决方案**: 使用 **Fuzzy Patching** (类似 `git apply --3way`)。
* Task Payload 中包含 `original_checksum`。
* Agent 提交 Patch 时，如果文件已变，`ContextService` 尝试自动 merge。如果冲突，抛出 `CONFLICT` 任务给 User 手动解决。

#### C. Version 0 Scope (MVP)

为了跑通核心流程，V0 专注于 **"The Golden Loop"**:

1. **Single Agent**: 只有一个 `UniversalAgent`，既处理 Chat 也处理 TODO。
2. **In-Memory Billboard**: 不做持久化，RxJS Subject 即可。
3. **Interactive CLI**:
 * User 输入指令 -> 触发 Task。
 * CLI 订阅该 Task 的流，把 LLM 的 `token stream` 打印到屏幕（伪装成同步，实则异步）。
 * 当 Task 完成，CLI 渲染 Diff。
 * User 按 `Y` -> 写入磁盘。

### 6. 为什么这个架构更好？

1. **解耦 (Decoupling)**: 增加新的功能（如 "自动查阅文献"）只需增加一个新的 `ResearcherAgent` 订阅相关 Task，完全不影响核心交互逻辑。
2. **可扩展性 (Scalability)**: 未来可以将耗时的 Agent 放到云端运行，CLI 只需要连接远程的 Billboard (WebSocket)。
3. **用户体验 (UX)**: 完美支持 "User as Manager" 的模式。你可以盯着它干活 (Attach)，也可以给它派活然后去喝咖啡 (Async TODOs)。
4. **可测试性**: 每个 Agent 都可以独立 Mock Billboard 进行单元测试。

### 7. V0 Roadmap (Revised)

1. **M1: The Infrastructure**: 搭建 RxJS Billboard, 定义 Task 类型, 实现 FileSystem Wrapper。
2. **M2: The Universal Agent**: 实现一个能通过 LLM 处理 `payload: { instruction, context }` 并返回 `diff` 的 Agent。
3. **M3: The CLI (Attach Mode)**: 实现 User 输入 -> Task -> Agent -> Stream Output -> User Confirm 的闭环。
4. **M4: TODO Injection**: 实现解析 `file:line instruction` 格式，将其转化为 Task 推入 M1 的 Billboard。由于 M2 和 M3 已经解耦，这一步几乎是免费的。

这个架构设计将 **"Vibe Coding"** 的流畅感与 **"Co-Author"** 的异步协作特性完美融合了。

---
## 🧑‍💻 User

你现在需要写一个*详细*、*高信息密度*、逻辑清晰严密的文档，描述我们定下的最终ver0版本，指导ver0开发。（高信息密度 != 短，反而因为信息密度高，这个文档足够好用）更多关注clean&clear, extensible&scalable的软件*架构*、交互逻辑（user-friendly interaction/agent flow），更多描述，减少不必要的代码展示。

给出中文文档（covers 目标 ... 架构设计 ... Milestone ...，事无巨细）

---
## 🤖 Assistant

# CoAuthor（V0）架构与交互设计文档（开发指导版）

> 版本：V0 目标实现规范（CLI REPL 为主要交互入口）
> 关键词：**Task 驱动 / Actor 一等公民 / Event Log 审计 / RxJS 流式调度 / LLM Workflow 可附着（attach）/ LaTeX-first / Outline.md 契约 / 可扩展到 Overleaf 插件**
> 读者：负责 V0 开发与后续扩展（V1 TODO 池、Overleaf/Chrome 插件、更多 Agents）的工程人员

---

## 0. 背景与定位

CoAuthor 是一个面向 STEM 学术写作的“合著者型系统”：

- **User = Reviewer/PI**：提出需求、提供事实与资产（实验、图、代码、数据）、做最终裁决（接受/拒绝/调整）。
- **LLM Agents = Co-author/Postdoc**：主动规划、起草、逐段落修改，产出可审阅的计划与可回滚的 patch，并持续维护一致性。

**核心差异**：写作不可像 coding 那样用 test case 验证“正确性”。因此 CoAuthor 的工程策略是：
- 将“正确性”替换为 **可审计、可追踪、可回滚、可编译（LaTeX）**；
- 将“生成质量”替换为 **计划先行（plan-first）、小步修改（patch-first）、人类确认（review-first）**；
- 将“上下文理解”工程化为 **Outline 契约 + 稳定 Brief/Style + 局部段落范围 + 资产引用**。

---

## 1. V0 目标 / 非目标 / 约束

### 1.1 V0 目标（必须达成）
1. **端到端跑通 Claude Code 风格的主流程**（最重要代表性 workflow）
 - 用户通过 REPL 输入请求（chat 指令或 slash 命令）
 - 系统将请求统一封装为 Task，进入共享的任务池（Billboard）
 - Agent 领取 Task，构建上下文，先输出 **修改计划（plan）**，再输出 **patch（diff）**
 - 用户审阅并确认应用 patch
 - 文件变更被监控，Agent 对用户手动修改具备“感知与重放/重基线（rebase）”能力
2. **LaTeX-first 工程**
 - 主产物为 `.tex` 文件（可分章节 include）
 - 能对 patch 应用后进行最小编译检查（可选：latexmk）
3. **OUTLINE.md 契约与灵活性**
 - 大纲是独立 Markdown 文档 `OUTLINE.md`，用户可随时修改
 - 系统能读取并注入 outline 作为全局上下文之一（V0 不强制“锁定”，但必须感知变化）
4. **架构可扩展**
 - CLI 仅为一种 Adapter；未来可接 Overleaf/Chrome 插件
 - V1 的 TODO comment 异步池，只需新增 Adapter + 调度策略，不应重写核心

### 1.2 V0 非目标（明确不做或弱化）
- 不做 GUI / Web 产品（仅 CLI REPL；可选 Ink TUI）
- 不做复杂多 Agent 群体协作（V0 至少 1 个 Default Agent 足够；多 Agent 预留架构）
- 不做强 RAG/Related Work 完整流水线（可留接口；V0 只需资产系统最小骨架）
- 不强制自动把 TODO 真的写进 tex 注释（TODO 的“呈现”为 UX 层问题；源数据应在 Billboard 里）

### 1.3 关键约束（必须遵守）
- **系统不得“猜测”实验图/结果图的含义**：结果解释必须来自用户提供的资产元信息（V0 可先不实现 VLM，但资产元信息管线必须预留）
- **所有写作修改必须走 patch → review → apply**：禁止静默覆盖文件
- **Task 不做细分类**：任务“是什么”由 **路由到的 Agent + 该 Agent 的 workflow** 决定（Task schema 通用化）

---

## 2. 核心理念与术语

### 2.1 Actor 一等公民
- **Actor** = 能参与任务协作的主体：Human User 或 LLM Agent
- User 只是带特殊权限/标记的 Actor（例如能最终 apply patch 或能否自动 apply）

### 2.2 Task 驱动协作
- 所有交互（用户 chat、slash 命令、未来 TODO comment、未来 Overleaf 选区操作）都被统一抽象为 **Task**。
- 所有产出（plan、patch、反馈、状态变化、artifact 变更）都作为 **TaskEvent** 写入事件流，形成可审计链路。

### 2.3 Billboard（共享任务池）
你提出的 billboard 在工程上应落地为：
- **Event Store（追加写、可回放）**
- **Projection（派生读模型）**
- **RxJS Streams（实时订阅、调度、UI 更新、Agent 触发）**

---

## 3. 用户体验与交互逻辑（V0）

### 3.1 REPL 交互模式总览
V0 提供一个长期运行的 REPL：

- 用户既可以“像聊天一样”直接输入自然语言（默认变成一个 foreground Task）
- 也可以用 `/` 命令显式触发（更可控、可脚本化）
- REPL UI 支持“附着到某个任务线程”（attach），呈现 Agent 的工作流进度、plan、patch、候选版本等——**这就是 Claude Code 的核心体验**：用户看到 Agent 在做什么、改哪里、为什么。

### 3.2 用户可用命令（建议最小集合）
> 命令只是 Adapter 层，不应侵入核心领域逻辑。命令最终要么创建 Task，要么在 Task thread 上追加事件（accept/reject/feedback）。

**Task 创建类**
- `/ask <text>`：创建 foreground Task（默认分配给 default agent）
- `/edit <file:range> <text>`：创建 foreground Task，并附带 artifactRefs（范围明确）
- `/draft <outlineAnchorOrHint> <text>`：创建 foreground Task；上下文构建器会强注入 OUTLINE.md
- `/tweak <file:range> <goal> --n 3`：创建 foreground Task（期望返回多个候选）
- （预留）`/todo add <file:range> <comment>`：创建 background Task（V1）

**Review / Control 类**
- `/tasks`：列出 open / awaiting_review 等任务
- `/open <taskId>`：附着到 task thread（进入该任务的“会话视图”）
- `/accept <proposalId>`：接受某个 patch proposal，触发 apply
- `/reject <proposalId> [reason]`：拒绝 patch，并追加反馈事件
- `/followup <taskId> <text>`：在该 task thread 里继续提要求（追加 UserFeedback）
- `/cancel <taskId>`：取消任务（若 agent 正在执行要支持取消信号）
- `/agent <name>`：切换 default agent（可选）

### 3.3 “计划先行”的输出规范（强制）
对于任何会修改文本的任务，Agent 必须按固定模板输出两段结构化产物：

1) **Plan（修改计划/意图/要点）**：面向人审阅
- 修改目标（Goal）
- 识别到的问题（Issues）
- 计划采取的策略（Strategy）
- 改动范围（Scope：哪些段落/句子/section）
- 风险提示（Risk：可能引入重复、需要用户补充信息、需要引用/图表 meta 等）
- 若缺少关键事实/资产 meta：明确提出问题（Blocking questions）

2) **Patch Proposal（差异补丁）**：面向机器应用 + 人审阅
- 以 unified diff 或等价结构化 patch 表达
- 必须能定位到 artifact + range（或基于 anchor）
- 必须声明其 baseRevision（用于 drift 检测）

用户看到 plan 后再看 patch，最终用 `/accept` 应用。

---

## 4. 系统架构总览（Clean + Extensible）

采用 **Hexagonal Architecture（端口-适配器）**：

- **Domain（领域层）**：Actor、Task、Artifact、事件、策略（纯 TS，无外部依赖）
- **Application（应用层）**：UseCases（创建任务、路由、运行 agent workflow、apply patch、rebase）、ContextBuilder
- **Infrastructure（基础设施层）**：SQLite EventStore、文件系统监控、LLM Provider、diff 引擎、LaTeX 编译器适配
- **Interfaces（接口层）**：CLI REPL / 未来 Overleaf Adapter / TODO Adapter

核心“管道”如下：

**User/Agent（Actor） → Task → Billboard（事件流） → Router/Scheduler → Agent Runtime（workflow） → Plan/Patch events → User review → ApplyPatch → ArtifactChanged events → Loop**

---

## 5. 领域模型（Domain Model）— V0 必须实现的最小实体

### 5.1 Actor
字段建议：
- `id`
- `kind: 'human' | 'agent'`
- `displayName`
- `capabilities`（权限/能力声明，决定是否允许 apply patch、是否允许运行 latexmk 等）
- `defaultAgentId`（仅 human 需要）

### 5.2 Artifact（论文与资产统一抽象）
字段建议：
- `id`
- `type: 'tex' | 'outline_md' | 'bib' | 'figure' | 'data' | 'code' | 'other'`
- `path`
- `revision`（hash 或 mtime+size；建议 hash，利于 drift）
- `metadata`（V0 可空；但必须可扩展用于图/代码 meta）

**V0 必需 Artifact 类型**：
- `OUTLINE.md`
- `main.tex` 与 `chapters/*.tex`（或用户自定义结构）
- 可选：`STYLE.md` / `BRIEF.md`（若存在则注入上下文）

### 5.3 Task（通用任务载体）
建议字段：
- `taskId`
- `createdBy: ActorId`
- `assignedTo?: ActorId`（可空）
- `priority: 'foreground' | 'normal' | 'background'`
- `status: 'open' | 'claimed' | 'in_progress' | 'awaiting_review' | 'done' | 'blocked' | 'canceled'`
- `intent`（string + 可选 structured）
- `artifactRefs?: Array<{ path; range?: {lineStart; lineEnd} }>`
- `baseRevisions?: Record<path, revision>`（创建或 claim 时快照）
- `threadId`（任务评论串）
- `timestamps`

### 5.4 TaskEvent（事件是审计主干）
最小事件集（V0）：
- `TaskCreated`
- `TaskRouted`
- `TaskClaimed`
- `TaskStarted`
- `AgentPlanPosted`
- `PatchProposed`
- `UserFeedbackPosted`
- `PatchAccepted`
- `PatchRejected`
- `PatchApplied`
- `TaskCompleted`
- `TaskFailed`
- `ArtifactChanged`（来自 FileWatcher）
- `TaskRebased` / `TaskNeedsRebase`（drift 处理）

事件必须带：
- `eventId`
- `taskId`
- `authorActorId`
- `timestamp`
- `payload`（zod 校验）

---

## 6. Billboard（共享任务池）设计（V0 核心）

Billboard 是 V0 的“协作中枢”，它必须同时做到：

1) **统一入口**：所有 Adapter 只需 `appendEvent(TaskCreated)`
2) **统一出口**：UI 与 Agents 通过订阅 streams 得到最新任务状态与产物
3) **审计与可回放**：任何异常都可通过事件回放复盘
4) **高扩展性**：未来多 Agent、多 UI、多入口不会改变核心

### 6.1 组件拆分
- **EventStore（持久化）**：SQLite（推荐）或 JSONL（原型可用）
- **Projector / Projection（派生读模型）**：将事件流折叠成 `TaskView`、`ThreadView`、`ArtifactIndex`
- **Billboard API（应用层端口）**：
 - `appendEvent(event)`
 - `getTask(taskId)`
 - `queryTasks(filter)`
 - `getThread(taskId)`
 - `events$`（RxJS Observable）
 - `taskViews$`（可选：投影输出流）

### 6.2 RxJS 流式调度（Router + Scheduler）
- **RouterPolicy**：把“未分配任务”分配给某个 actorId
 - V0 规则：`assignedTo = (user指定) ? specifiedAgent : user.defaultAgent`
- **SchedulerPolicy**：决定 agent 何时执行
 - foreground：优先执行
 - background：空闲执行（V0 可不实现 background，但 pipeline 要支持）

> 重要：Router/Scheduler 是“纯策略层”，不依赖 CLI，不依赖具体 LLM。

---

## 7. Agent Runtime（V0 的“像 Claude Code 一样工作”）

### 7.1 AgentHost 与并发模型
V0 推荐一个 AgentHost 进程，管理多个 agent（至少一个 Default CoAuthor Agent）。

- 每个 agent 订阅 `Billboard.taskViews$`
- 过滤出“分配给自己且可执行”的任务：
 - `status=open` 或 `status=claimed但未开始`
- 使用 RxJS `mergeMap` 控制并发：
 - V0 建议 **写作类任务单并发 = 1**（避免两个任务同时改同一个文件造成冲突）
 - 读取类任务可并发更高（V1 再细化）

### 7.2 Agent 的端口依赖（必须解耦）
Agent 不应直接调用 SQLite、FS、LLM SDK；只依赖抽象端口：

- `BillboardClient`
- `ArtifactStore`（readFile、getRevision、listFiles）
- `PatchEngine`（生成/应用/校验 patch）
- `LLMClient`（支持多 profile）
- `Diagnostics`（可选：latex build / lint）

这样未来换 UI、换模型、换存储不影响 workflow。

### 7.3 Default CoAuthor Agent：V0 代表性 workflow
V0 只需要一个主 agent，但它必须把“plan → patch → review → apply”的体验做扎实。

**Workflow（写作/改稿类任务的统一骨架）**

1) **Claim**
- 读取 TaskView
- 写入 `TaskClaimed`（author=agent）
- 生成 `baseRevisions` 快照（对 task 涉及的 artifacts：tex 文件、OUTLINE.md 等）

2) **Build Context**
- 读取 `OUTLINE.md`（始终注入）
- 读取 `BRIEF.md`、`STYLE.md`（若存在）
- 若 task 指定了 `artifactRefs`：读取对应 file range 的文本
- 若未指定范围：使用启发式选择焦点（例如最近修改的章节、或 main.tex include 的当前章；V0 可简单：让用户显式指定或提示补充）
- 形成一个结构化 Context Package（而不是拼长字符串），便于后续替换/压缩

3) **Drift Check（用户手改感知）**
- 对比当前 artifact revision 与 task.baseRevisions：
 - 若关键文件变化：记录 `TaskNeedsRebase` 或在 plan 中显式提示“我将基于最新版本重新生成 patch”
 - V0 推荐：自动读取最新内容并继续（即“自动 rebase”），但要记录事件说明发生了 drift

4) **Plan（使用 reasoning/thinking 或 writer 的 plan 模式）**
- 输出 **计划要点**（AgentPlanPosted）
- 若缺关键信息（比如“图表想表达什么”）：
 - 将 task 状态置为 `blocked`
 - 在 plan 里提出明确问题（并可自动创建一个“需要用户回答”的子 task，V1 再做；V0 可直接在 thread 里提问）

5) **Patch Proposal（使用 writer profile）**
- 生成 unified diff（或结构化 patch）并附带：
 - 修改文件列表
 - baseRevision
 - patchId
- 写入 `PatchProposed`
- 将 task 状态置为 `awaiting_review`

6) **Wait Review（人类循环）**
- 用户 `/accept` → 触发 apply
- 用户 `/reject` 或 `/followup` → 写入反馈事件，agent 再次进入 Plan/Patch

7) **Apply Patch（建议由“ApplyUseCase”处理）**
- Apply 本身是应用层 use case（可由 human 触发，也可由具备权限的 agent 触发）
- Apply 前做最小校验：
 - baseRevision 是否匹配当前文件（否则要求 rebase）
 - patch 是否可 clean apply
- Apply 后写入 `PatchApplied` + `ArtifactChanged`（或由 FileWatcher 产出 ArtifactChanged）
- 任务置为 `done`

---

## 8. Context Engine（上下文构建）— V0 最小但必须正确

Context Engine 的目标是：**稳定全局 + 聚焦局部 + 可解释**，避免 LLM 重复、跑题、瞎改。

### 8.1 全局上下文（Always-on）
- `OUTLINE.md`（始终存在）
- `BRIEF.md`（如果存在）：论文在做什么、贡献是什么、读者是谁
- `STYLE.md`（如果存在）：语气、术语表、禁用词、时态、人称策略

> V0：以上文件不存在也要优雅降级；提示用户生成 BRIEF/STYLE 是 V1 可增强点。

### 8.2 局部上下文（Focus）
- 若 task 带 `artifactRefs(range)`：只读取指定范围（最强约束）
- 否则读取“最相关文件片段”（V0 允许简单策略：用户指定章节文件；或者最近修改文件）
- 读取相邻段落（可选）：用于降低重复（V1 可增强）

### 8.3 资产上下文（V0 预留接口）
图表/代码等资产在 V0 可以先只做：
- 能被注册为 Artifact（type=figure/code）
- 其 metadata 允许为空，但 workflow 在需要解释“结果图含义”时必须阻止瞎编并向用户提问

---

## 9. Patch / Review / Apply 体系（写作版的“可验证性”支柱）

写作不可测试，但 patch 机制提供：
- 可审阅、可回滚、可合并冲突处理、可审计链路

### 9.1 Patch 规范
V0 推荐统一 diff（unified diff）作为交换格式：
- 优点：易展示、易存储、可用成熟库 apply
- 必须包含：
 - 目标文件 path
 - base revision（hash）
 - patchId
 - 可选：受影响行范围

### 9.2 Apply 策略
- 默认：**手动确认 apply**（用户 `/accept`）
- ApplyUseCase 做三件事：
1) 校验 patch 是否基于当前 revision（否则拒绝并提示 rebase）
2) clean apply 写回文件
3) 追加 `PatchApplied` 事件，触发后续流程（可选 build）

### 9.3 最小质量闸门（V0）
- 必需：patch 可 clean apply、不会破坏文件编码
- 可选（强烈建议但可开关）：
 - `latexmk` 编译
 - 基础 lint（例如引用 key 是否存在、明显的 LaTeX 语法错误）

---

## 10. 文件变更感知（用户手改）— 必须具备的“协作真实感”

### 10.1 FileWatcher（基础设施）
- 监控：`*.tex`、`OUTLINE.md`、（可选）`BRIEF.md`、`STYLE.md`
- 每次变更：
 - 更新 Artifact revision
 - 追加 `ArtifactChanged` 事件（包含 path、newRevision）

### 10.2 Drift（漂移）处理原则
- Agent 处理任务时若发现 baseRevision 已过期：
 - 不直接 apply patch（防止覆盖用户新改动）
 - 自动 rebase（重新读取最新片段，重新生成 plan/patch）
 - 在 thread 中明确说明发生 drift 以及可能原因

---

## 11. LLM 模型支持（fast/base/thinking）— V0 需要但要工程化

### 11.1 LLMClient 抽象
必须支持：
- 多 provider（OpenAI/Anthropic/本地等）
- 多 profile（fast/writer/reasoning）
- 流式输出（用于 CLI 呈现“正在写”）
- tracing（记录 request/response 元信息到事件或日志，便于审计与调试）

### 11.2 Profile 用途规范（避免混用）
- **fast**：解析用户指令、轻量改写、多候选生成（/tweak）
- **writer**：生成 LaTeX 文本与 patch
- **reasoning/thinking**：生成 plan、检查一致性、跨文件结构性判断

> thinking 不是“随便开启”，而是 workflow 的明确 step。这样才能控制成本与稳定性。

---

## 12. CLI 只是 Adapter：为何与如何“可扩展到 Overleaf”

### 12.1 Adapter 原则
- Adapter 做的事只有：
1) 将外部输入转换为 TaskCreated / UserFeedback / PatchAccepted 等事件
2) 订阅 task thread 并展示
- Adapter 不包含任何“写作逻辑”，写作逻辑在 Agent workflow 中

### 12.2 Overleaf/Chrome 插件（未来）如何接入（无需重构）
- 插件将“选区 + 评论”转成 artifactRefs + intent → TaskCreated
- 插件展示 thread 中的 plan/patch/候选 → 用户点击 accept → PatchAccepted
- 全部复用 Billboard + Agent Runtime

---

## 13. V0 目录与工程组织建议（清晰、可扩展）

建议 monorepo 或单包均可，核心是分层明确：

- `domain/`：实体、事件、策略（纯逻辑）
- `application/`：用例（PostTask/RouteTask/RunAgent/ApplyPatch）、ContextBuilder
- `infrastructure/`：SQLite store、FS watcher、LLM provider、diff/latex 工具适配
- `interfaces/cli/`：REPL、命令解析、视图渲染（Ink 可选）
- `agents/`：agent runtime 与 workflows

同时强制：
- schema 校验（zod）
- DI（tsyringe/inversify）让端口可替换
- 统一日志与 trace id（关联 taskId）

---

## 14. Milestone 计划（V0 开发路线，按价值优先）

> 原则：尽早把“LLM 端到端跑通 + patch/review/apply”做出来；其它能力在此之上叠加。

### M0：Billboard 基础闭环（无 LLM 也能跑）
- 实现 EventStore（SQLite）+ Projection
- CLI 能创建 task、列出 task、打开 thread
- 手动贴入一个 patch proposal 也能 accept/apply（验证 apply pipeline）

**验收**：你能创建任务、看到事件流、能通过 accept 应用 patch 到 tex 文件，并在日志里回放发生过什么。

### M1：端到端 LLM Workflow（V0 的核心里程碑）
- Default CoAuthor Agent 接入 LLMClient
- workflow：claim → context → plan → patch proposed → awaiting_review
- CLI 展示 plan + diff，支持 `/accept` `/reject` `/followup`
- FileWatcher 产出 ArtifactChanged（至少 OUTLINE.md 与 tex）

**验收**：像 Claude Code 一样：用户一句话改某段 → agent 给计划 → 给 diff → 用户确认 → 文件更新。

### M2：Drift/rebase（用户手改感知）变成稳定能力
- task.baseRevisions 与 artifact revision 对比
- patch apply 时强校验 baseRevision
- agent 自动 rebase 并记录事件

**验收**：用户在 agent 生成 patch 期间手动改文件，系统不会盲目覆盖；会提示并基于新版本重新出 patch。

### M3：多 profile 模型与 thinking step（成本/质量可控）
- 实现 fast/writer/reasoning profiles
- plan 用 reasoning，patch 用 writer，轻量解析用 fast
- 基本 tracing（写入日志或事件摘要）

**验收**：同一任务可清晰看到 plan 的生成与 patch 的生成由不同 profile 驱动，成本可控。

### M4（可选增强，仍属 V0 范围）：OUTLINE/BRIEF/STYLE 结构化注入
- ContextBuilder 稳定注入 OUTLINE
- BRIEF/STYLE 若存在自动注入，并在缺失时提示用户创建

**验收**：改文风、改章节目标等效果显著提升且更少重复。

### V1（明确延后）：TODO comment 异步池 + background scheduler
- `/todo add` → background Task
- Scheduler 空闲执行，agent 完成后自动回报
- TODO 的“呈现”为 LaTeX 注释或 UI overlay（Adapter 负责）

---

## 15. 测试与质量保障（V0 应该怎么测）

写作质量难测，但系统行为必须可测：

1. **Domain 单测**
 - event → projection 的状态机正确性
 - 路由策略（RouterPolicy）
 - scheduler 规则（优先级、并发控制）
2. **集成测试（关键）**
 - 给定一个 tex 文件，模拟 Task → 生成 patch → apply → 文件变化被 watcher 捕获
 - drift 场景：apply 前修改文件导致 baseRevision mismatch
3. **回放测试**
 - 从事件日志回放到某一时刻，TaskView 应一致（审计能力验证）

---

## 16. V0 最终形态总结（你在开发中要“守住”的几条）

1. **所有输入都变成 Task；所有输出都进入事件流**
2. **plan-first + patch-first + review-first** 是 CoAuthor 的默认协议
3. **用户随手改文件不会被覆盖**（revision/drift 是系统内建机制）
4. **CLI 只是一个输入/输出适配器**；未来 Overleaf 插件不需要改核心
5. **Task 不分类**；行为差异来自 agent/workflow 的选择与路由
6. **先把 LLM 跑通整个闭环放在最前**（M1 是 V0 成败关键）

---

如果你希望我继续把该文档“落到可直接开工的接口级别”，下一步我建议输出三份补充规格（仍然偏架构，不大量代码）：

1) **TaskEvent Schema 规范**（每个事件 payload 字段、必填/可选、zod 校验策略）
2) **Agent Workflow Contract**（每步输入输出、何时写哪些事件、取消/重试/超时策略）
3) **Patch 格式与定位策略**（unified diff 细则、baseRevision 计算、range 定位与容错）

这样开发可以并行推进：Billboard、CLI、Agent、FS Watcher、LLMClient 各自按 contract 实现，最后无缝拼装。
