import { type Argv, type Arguments } from 'yargs'
import { type App } from '../../app/createApp.js'
import type { LLMMessage, LLMResponse, LLMStopReason } from '../../domain/ports/llmClient.js'
import type { ToolCallRequest, ToolDefinition } from '../../domain/ports/tool.js'
import { type IO } from '../io.js'

export function registerLlmCommand(parser: Argv, app: App, io: IO): Argv {
  return parser.command(
    'llm <action>',
    'LLM client operations',
    (y: Argv) =>
      y
        .positional('action', { type: 'string', choices: ['test'] as const, demandOption: true })
        .option('mode', { type: 'string', choices: ['complete', 'stream', 'tool_use', 'stream_tool_use'] as const, default: 'complete' }),
    async (args: Arguments) => {
      const action = String(args.action)
      if (action === 'test') {
        const mode = String(args.mode ?? 'complete')
        io.stdout(`Testing LLM client connection (mode: ${mode})...\n`)
        
        try {
          const startTime = Date.now()
          
          if (mode === 'complete') {
            const response = await app.llm.complete({
              profile: 'fast',
              messages: [
                { role: 'system', content: 'You are a helpful assistant.' },
                { role: 'user', content: 'Say "OK" if you can hear me.' }
              ],
              maxTokens: 50
            })
            
            const duration = Date.now() - startTime
            io.stdout(`✓ Connection successful (${duration}ms)\n`)
            io.stdout(`  Response: ${response.content ?? '(no content)'}\n`)
            io.stdout(`  Stop reason: ${response.stopReason}\n`)
          } else if (mode === 'tool_use') {
            const tools: ToolDefinition[] = [
              {
                name: 'get_weather',
                description: 'Get current weather for a location',
                parameters: {
                  type: 'object',
                  properties: {
                    location: { type: 'string', description: 'City name' },
                    unit: { type: 'string', enum: ['celsius', 'fahrenheit'] }
                  },
                  required: ['location']
                }
              }
            ]
            const messages: LLMMessage[] = [
              { role: 'system', content: 'You are a helpful assistant.' },
              { role: 'user', content: 'What is the weather in Tokyo? Use the tool if needed.' }
            ]
            const allToolCalls: ToolCallRequest[] = []
            const maxToolIterations = 4
            let finalResponseContent: string | undefined
            let finalStopReason: LLMResponse['stopReason'] | undefined
            
            for (let iterationIndex = 0; iterationIndex < maxToolIterations; iterationIndex += 1) {
              const response = await app.llm.complete({
                profile: 'fast',
                messages,
                tools,
                maxTokens: 1024
              })
              if (response.stopReason === 'tool_use') {
                io.stdout(`[Iteration ${iterationIndex}] Tool use: ${response.toolCalls?.map(tc => tc.toolName).join(', ') || '(no tool use)'} (Stop reason: ${response.stopReason})\n`)
              } else {
                io.stdout(`[Iteration ${iterationIndex}] Response: ${response.content ?? '(no content)'} (Stop reason: ${response.stopReason})\n`)
              }
              finalStopReason = response.stopReason
              if (response.toolCalls && response.toolCalls.length > 0) {
                allToolCalls.push(...response.toolCalls)
                messages.push({
                  role: 'assistant',
                  content: response.content,
                  toolCalls: response.toolCalls,
                  reasoning: response.reasoning
                })
                for (const toolCall of response.toolCalls) {
                  const argumentsRecord = (toolCall.arguments ?? {}) as Record<string, unknown>
                  const locationValue = typeof argumentsRecord.location === 'string' ? argumentsRecord.location : 'Tokyo'
                  const unitValue = typeof argumentsRecord.unit === 'string' ? argumentsRecord.unit : 'celsius'
                  const toolResult = {
                    location: locationValue,
                    unit: unitValue,
                    temperature: 21,
                    condition: 'Partly cloudy'
                  }
                  messages.push({
                    role: 'tool',
                    toolCallId: toolCall.toolCallId,
                    content: JSON.stringify(toolResult),
                    toolName: toolCall.toolName
                  })
                }
                continue
              }
              if (response.content) {
                finalResponseContent = response.content
              }
              if (response.stopReason !== 'tool_use') {
                break
              }
            }
            
            if (!finalResponseContent && finalStopReason === 'tool_use') {
              throw new Error('Tool use did not complete within the allowed iterations')
            }
            const duration = Date.now() - startTime
            io.stdout(`✓ Connection successful (${duration}ms)\n`)
            io.stdout(`  Response: ${finalResponseContent ?? '(no content)'}\n`)
            if (allToolCalls.length > 0) {
              io.stdout(`  Tool Calls:\n`)
              for (const toolCall of allToolCalls) {
                io.stdout(`    - ${toolCall.toolName}(${JSON.stringify(toolCall.arguments)})\n`)
              }
            } else {
              io.stdout(`  Tool Calls: (none)\n`)
            }
            io.stdout(`  Stop reason: ${finalStopReason ?? 'end_turn'}\n`)
          } else if (mode === 'stream_tool_use') {
            const tools: ToolDefinition[] = [
              {
                name: 'get_weather',
                description: 'Get current weather for a location',
                parameters: {
                  type: 'object',
                  properties: {
                    location: { type: 'string', description: 'City name' },
                    unit: { type: 'string', enum: ['celsius', 'fahrenheit'] }
                  },
                  required: ['location']
                }
              }
            ]
            const messages: LLMMessage[] = [
              { role: 'system', content: 'You are a helpful assistant.' },
              { role: 'user', content: 'What is the weather in Tokyo? Use the tool if needed.' }
            ]
            
            const maxToolIterations = 4
            let finalStopReason: LLMResponse['stopReason'] | undefined
            
            for (let iterationIndex = 0; iterationIndex < maxToolIterations; iterationIndex += 1) {
              if (iterationIndex > 0) io.stdout('\n')
              io.stdout(`[Iteration ${iterationIndex + 1}] Streaming response...\n`)
              
              let currentTextContent = ''
              let currentReasoningContent = ''
              const currentToolCalls = new Map<string, { toolName: string; argumentsStr: string }>()
              let streamStopReason: LLMStopReason = 'end_turn'
              
              for await (const chunk of app.llm.stream({
                profile: 'fast',
                messages,
                tools,
                maxTokens: 1024
              })) {
                if (chunk.type === 'text') {
                  currentTextContent += chunk.content
                } else if (chunk.type === 'reasoning') {
                  currentReasoningContent += chunk.content
                } else if (chunk.type === 'tool_call_start') {
                  currentToolCalls.set(chunk.toolCallId, { toolName: chunk.toolName, argumentsStr: '' })
                } else if (chunk.type === 'tool_call_delta') {
                  const tc = currentToolCalls.get(chunk.toolCallId)
                  if (tc) tc.argumentsStr += chunk.argumentsDelta
                } else if (chunk.type === 'done') {
                  streamStopReason = chunk.stopReason
                }
              }

              io.stdout(`===== Text =====\n ${currentTextContent}\n`)
              io.stdout(`===== Reasoning =====\n ${currentReasoningContent}\n`)
              io.stdout('\n')

              // Reconstruct assistant message
              const toolCallsRequest: ToolCallRequest[] = []
              for (const [id, tc] of currentToolCalls) {
                try {
                  toolCallsRequest.push({
                    toolCallId: id,
                    toolName: tc.toolName,
                    arguments: JSON.parse(tc.argumentsStr)
                  })
                } catch {
                  io.stderr(`Failed to parse args for tool ${tc.toolName}\n`)
                }
              }
              
              messages.push({
                role: 'assistant',
                content: currentTextContent || undefined,
                toolCalls: toolCallsRequest.length > 0 ? toolCallsRequest : undefined,
                reasoning: currentReasoningContent || undefined
              })
              
              if (streamStopReason === 'tool_use' && toolCallsRequest.length > 0) {
                for (const tc of toolCallsRequest) {
                  io.stdout(`  Executing tool: ${tc.toolName} args=${JSON.stringify(tc.arguments)}\n`)
                  const argumentsRecord = tc.arguments as Record<string, unknown>
                  const locationValue = typeof argumentsRecord.location === 'string' ? argumentsRecord.location : 'Tokyo'
                  const unitValue = typeof argumentsRecord.unit === 'string' ? argumentsRecord.unit : 'celsius'
                  const toolResult = {
                    location: locationValue,
                    unit: unitValue,
                    temperature: 21,
                    condition: 'Partly cloudy'
                  }
                  messages.push({
                    role: 'tool',
                    toolCallId: tc.toolCallId,
                    content: JSON.stringify(toolResult),
                    toolName: tc.toolName
                  })
                }
                continue
              }
              
              finalStopReason = streamStopReason
              if (streamStopReason !== 'tool_use') {
                break
              }
            }
            
            io.stdout(`  Stop reason: ${finalStopReason ?? 'end_turn'}\n`)
          } else {
            // stream mode
            io.stdout(`  Streaming response...\n`)
            let textContent = ''
            let reasoningContent = ''
            
            for await (const chunk of app.llm.stream({
              profile: 'fast',
              messages: [
                { role: 'system', content: 'You are a helpful assistant.' },
                { role: 'user', content: 'Say "OK" if you can hear me.' }
              ],
              maxTokens: 1024
            })) {
              if (chunk.type === 'text') {
                textContent += chunk.content
              } else if (chunk.type === 'reasoning') {
                reasoningContent += chunk.content
              } else if (chunk.type === 'tool_call_start') {
                throw new Error('Unexpected tool call in test prompt')
              } else if (chunk.type === 'done') {
                const duration = Date.now() - startTime
                io.stdout(`\n✓ Connection successful (${duration}ms)\n`)
                io.stdout(`  Response: ${textContent || '(no content)'}\n`)
                if (reasoningContent) {
                  io.stdout(`  Reasoning: ${reasoningContent.slice(0, 100)}${reasoningContent.length > 100 ? '...' : ''}\n`)
                }
                io.stdout(`  Stop reason: ${chunk.stopReason}\n`)
              }
            }
          }
        } catch (error) {
          io.stdout(`✗ Connection failed\n`)
          io.stderr(`  Error: ${error instanceof Error ? error.message : String(error)}\n`)
          throw error
        }
        return
      }
    }
  )
}
