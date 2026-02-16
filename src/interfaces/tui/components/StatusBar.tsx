import React from 'react'
import { Box, Text } from 'ink'
import type { TaskView } from '../types.js'
import { getStatusIcon, getStatusLabel, createSeparatorLine, truncateText } from '../utils.js'

type Props = {
  focusedTask: TaskView | undefined
  columns: number
  breadcrumb?: string[]
  activeAgentId?: string
  activeProfile?: string
}

export function StatusBar({ focusedTask, columns, breadcrumb, activeAgentId, activeProfile }: Props) {
  const separatorLine = createSeparatorLine(columns)
  const taskTitle = focusedTask ? focusedTask.title : '(no task focused)'
  const taskStatus = focusedTask ? focusedTask.status : ''
  const statusIcon = getStatusIcon(taskStatus)
  const statusLabel = focusedTask ? getStatusLabel(taskStatus) : ''
  const agentLabel = activeAgentId ? activeAgentId.replace(/^agent_/, '') : ''
  const profileLabel = activeProfile ?? ''
  const breadcrumbText = breadcrumb && breadcrumb.length > 1
    ? truncateText(breadcrumb.slice(0, -1).join(' › '), Math.max(10, columns - 40))
    : ''

  return (
    <>
      <Text dimColor>{separatorLine}</Text>
      <Box height={1} width="100%" paddingX={1}>
        <Box flexGrow={1}>
          <Text color="cyan" bold>
            Seed
          </Text>
          <Text dimColor> │ </Text>
          {agentLabel ? (
            <>
              <Text color="magenta">{agentLabel}</Text>
              <Text dimColor> │ </Text>
            </>
          ) : null}
          {profileLabel ? (
            <>
              <Text color="yellow">{profileLabel}</Text>
              <Text dimColor> │ </Text>
            </>
          ) : null}
          {breadcrumbText ? (
            <>
              <Text dimColor>{breadcrumbText} › </Text>
            </>
          ) : null}
          <Text bold>{truncateText(taskTitle, Math.max(10, columns - 60))}</Text>
          <Text> {statusIcon} </Text>
          <Text color="yellow">{statusLabel}</Text>
        </Box>
        <Text dimColor>Tab:tasks │ Ctrl+D:exit</Text>
      </Box>
    </>
  )
}
