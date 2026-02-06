# Tool Parameter Schema Adaptation (Minimal Implementation)

## Background

LLM tool parameter definitions use JSON Schema (see [tool.ts](file:///Users/yangjerry/Repo/coauthor/src/domain/ports/tool.ts#L42-L52)).

When adapting to the AI SDK, an `inputSchema` must be provided. The current implementation uses two paths:

- Simple schema: JSONSchema → Zod (fast, stable behavior)
- Complex schema (few scenarios): Directly use AI SDK `jsonSchema(...)` (to avoid implementing a full converter)

## Complexity Determination (Estimated <5% of use cases)

A schema is considered complex if it has any of the following characteristics:

- A property is an object and contains nested properties
- `array.items` is an object/array or contains properties

The determination logic can be found in [toolSchemaAdapter.ts](file:///Users/yangjerry/Repo/coauthor/src/infra/toolSchemaAdapter.ts).

## Strategy and Rollback

Controlled via environment variables:

- `COAUTHOR_TOOL_SCHEMA_STRATEGY=auto` (default): Use Zod for simple, jsonSchema for complex
- `COAUTHOR_TOOL_SCHEMA_STRATEGY=zod`: Force Zod for everything (rollback path)
- `COAUTHOR_TOOL_SCHEMA_STRATEGY=jsonschema`: Force jsonSchema for everything
