# 工具参数 Schema 适配（最小实现）

## 背景

LLM 工具参数定义使用 JSON Schema（见 [tool.ts](file:///Users/yangjerry/Repo/coauthor/src/domain/ports/tool.ts#L42-L52)）。

适配到 AI SDK 时，需要提供 `inputSchema`。当前实现采用两种路径：

- 简单 schema：JSONSchema→Zod（快速、行为稳定）
- 复杂 schema（少数场景）：直接走 AI SDK `jsonSchema(...)`（避免实现完整转换器）

## 复杂度判定（预估 <5% 用例）

出现下列特征之一即视为复杂：

- property 为 object 且包含嵌套 properties
- array.items 为 object/array 或包含 properties

判定逻辑见 [toolSchemaAdapter.ts](file:///Users/yangjerry/Repo/coauthor/src/infra/toolSchemaAdapter.ts)。

## 策略与回滚

通过环境变量控制：

- `COAUTHOR_TOOL_SCHEMA_STRATEGY=auto`（默认）：简单用 Zod，复杂用 jsonSchema
- `COAUTHOR_TOOL_SCHEMA_STRATEGY=zod`：强制全量走 Zod（回滚路径）
- `COAUTHOR_TOOL_SCHEMA_STRATEGY=jsonschema`：强制全量走 jsonSchema
