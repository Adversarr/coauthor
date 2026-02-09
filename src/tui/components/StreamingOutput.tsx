import React from 'react'
import { Box, Text } from 'ink'
import { renderMarkdownToTerminalText } from '../utils.js'

type Props = {
  streamingText: string
  streamingReasoning: string
  width: number
}

/**
 * Live streaming output display. Shows accumulated reasoning (dimmed)
 * and text (green) deltas that update in real-time during LLM generation.
 * Only renders when content is available.
 */
export function StreamingOutput({ streamingText, streamingReasoning, width }: Props) {
  if (!streamingText && !streamingReasoning) return null

  return (
    <Box flexDirection="column" paddingX={1}>
      {streamingReasoning ? (
        <Text color="gray" dimColor>
          {'󰧑 '}{streamingReasoning}
        </Text>
      ) : null}
      {streamingText ? (
        <Text color="green" bold>
          {'→ '}{renderMarkdownToTerminalText(streamingText, width - 4)}
        </Text>
      ) : null}
    </Box>
  )
}
