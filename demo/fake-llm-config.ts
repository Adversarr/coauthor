/**
 * Fake LLM Configuration for CoAuthor Demo
 *
 * This configuration provides preset responses for the FakeLLMClient
 * to simulate a realistic agent workflow demonstrating tool use and UIP.
 *
 * Usage:
 * 1. Set FAKE_LLM_CONFIG_PATH to this file in your environment
 * 2. Or import and pass to FakeLLMClient
 */

import type { LLMResponse } from '../src/domain/ports/llmClient.js'

/**
 * Preset response sequence for the LaTeX paper editing demo.
 * This sequence demonstrates:
 * 1. listFiles (safe tool)
 * 2. readFile (safe tool)
 * 3. editFile (risky tool with UIP)
 * 4. Completion
 */
export const demoResponseSequence: LLMResponse[] = [
  // Step 1: After receiving task, list files to explore structure
  {
    content:
      "I'll start by exploring the paper structure. Let me list the files in the paper directory to understand the project layout.",
    toolCalls: [
      {
        toolCallId: 'call_1',
        toolName: 'listFiles',
        arguments: {
          path: 'demo/paper',
        },
      },
    ],
  },

  // Step 2: After listing files, read main.tex to understand structure
  {
    content:
      'I can see the paper directory structure. Now let me read the main.tex file to understand the paper structure and see what sections are included.',
    toolCalls: [
      {
        toolCallId: 'call_2',
        toolName: 'readFile',
        arguments: {
          path: 'demo/paper/main.tex',
        },
      },
    ],
  },

  // Step 3: After reading main.tex, edit the introduction
  {
    content:
      "I can see the paper structure with all its sections. The introduction section needs improvement. I'll modify the first paragraph to make it more engaging and clearly state the research contribution.",
    toolCalls: [
      {
        toolCallId: 'call_3',
        toolName: 'editFile',
        arguments: {
          path: 'demo/paper/sections/introduction.tex',
          oldString:
            'This is the introduction section of our research paper.',
          newString:
            'This paper presents a novel approach to collaborative academic writing using large language models, addressing the critical need for transparency and reproducibility in AI-assisted research workflows.',
        },
      },
    ],
  },

  // Step 4: After successful edit, add another improvement
  {
    content:
      "Good, the introduction now has a stronger opening. Let me also update the problem statement subsection to make it more specific about the challenges researchers face.",
    toolCalls: [
      {
        toolCallId: 'call_4',
        toolName: 'editFile',
        arguments: {
          path: 'demo/paper/sections/introduction.tex',
          oldString:
            'Current approaches to AI-assisted writing often lack transparency, making it difficult for researchers to understand and verify the contributions made by automated systems.',
          newString:
            'Current approaches to AI-assisted writing often lack transparency, making it difficult for researchers to understand and verify the contributions made by automated systems. Furthermore, the inability to track changes and reproduce AI-generated content creates significant challenges for peer review and scientific reproducibility.',
        },
      },
    ],
  },

  // Step 5: Completion
  {
    content:
      "I've successfully updated the introduction section with two key improvements:\n\n1. **Enhanced opening paragraph**: The introduction now clearly states the paper's contribution and its relevance to collaborative academic writing.\n\n2. **Expanded problem statement**: Added specific details about the challenges of transparency and reproducibility in AI-assisted writing.\n\nThe paper is now more compelling and clearly communicates its research contribution to readers.",
    toolCalls: [],
  },
]

/**
 * Helper function to create a cycling response provider
 * This allows the demo to loop through the response sequence indefinitely
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

/**
 * Export configuration for FakeLLMClient
 */
export default {
  name: 'CoAuthor LaTeX Demo',
  description:
    'A demonstration of CoAuthor tool use with a LaTeX academic paper',
  responses: demoResponseSequence,
  createCyclingResponseProvider,
}
