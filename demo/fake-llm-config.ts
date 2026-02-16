/**
 * Fake LLM configuration for the Seed demo.
 *
 * This file provides deterministic responses that demonstrate:
 * 1. read-only discovery tools (`listFiles`, `readFile`)
 * 2. risky edit flow (`editFile` + UIP confirmation)
 * 3. completion summary output
 */

import type { LLMResponse } from '../src/core/ports/llmClient.js'

/**
 * Preset response sequence for a general workspace-ops demo.
 */
export const demoResponseSequence: LLMResponse[] = [
  {
    content:
      "I'll begin by checking the demo data directory so I can understand what files are available.",
    toolCalls: [
      {
        toolCallId: 'call_1',
        toolName: 'listFiles',
        arguments: {
          path: 'demo/data',
        },
      },
    ],
  },
  {
    content:
      'I found the data files. Next I will read sample.txt and identify a concrete update to improve task clarity.',
    toolCalls: [
      {
        toolCallId: 'call_2',
        toolName: 'readFile',
        arguments: {
          path: 'demo/data/sample.txt',
        },
      },
    ],
  },
  {
    content:
      "I'll update one ambiguous line in sample.txt so the task list is actionable and prioritized.",
    toolCalls: [
      {
        toolCallId: 'call_3',
        toolName: 'editFile',
        arguments: {
          path: 'demo/data/sample.txt',
          oldString: 'Line 2: Sample data point B',
          newString: 'Line 2: Priority action item - validate onboarding flow',
        },
      },
    ],
  },
  {
    content:
      "I made the update successfully. The data file now has a clearer action-oriented line for execution tracking.",
    toolCalls: [],
  },
]

/**
 * Helper function to cycle through the response sequence.
 */
export function createCyclingResponseProvider(
  responses: LLMResponse[] = demoResponseSequence
) {
  let index = 0
  return (): LLMResponse => {
    const response = responses[index]
    index = (index + 1) % responses.length
    return response
  }
}

export default {
  name: 'Seed Workspace Demo',
  description: 'Demonstrates Seed tool use on a general workspace maintenance task',
  responses: demoResponseSequence,
  createCyclingResponseProvider,
}
