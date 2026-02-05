import { type Argv, type Arguments } from 'yargs'
import { type App } from '../../app/createApp.js'
import { type IO } from '../io.js'

export function registerLlmCommand(parser: Argv, app: App, io: IO): Argv {
  return parser.command(
    'llm <action>',
    'LLM client operations',
    (y: Argv) =>
      y
        .positional('action', { type: 'string', choices: ['test'] as const, demandOption: true })
        .option('mode', { type: 'string', choices: ['complete', 'stream'] as const, default: 'complete' }),
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
