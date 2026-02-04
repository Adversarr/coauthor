import React, { useEffect, useMemo, useState } from 'react'
import { Box, Text, useInput } from 'ink'
import TextInput from 'ink-text-input'
import type { App } from '../app/createApp.js'

type Props = {
  app: App
}

export function MainTui(props: Props) {
  const { app } = props
  const [input, setInput] = useState('')
  const [status, setStatus] = useState<string>('')
  const [tasks, setTasks] = useState<Array<{ taskId: string; title: string }>>([])
  const [replayOutput, setReplayOutput] = useState<string[]>([])

  const refresh = async () => {
    const result = await app.taskService.listTasks()
    setTasks(result.tasks.map((t) => ({ taskId: t.taskId, title: t.title })))
  }

  useEffect(() => {
    refresh().catch((e) => setStatus(e instanceof Error ? e.message : String(e)))
  }, [])

  const onSubmit = async (line: string) => {
    const trimmed = line.trim()
    setInput('')
    if (!trimmed) return

    try {
      if (!trimmed.startsWith('/')) {
        setStatus('命令需以 / 开头，输入 /help 查看可用命令')
        return
      }

      const commandLine = trimmed.slice(1)
      if (commandLine === 'help') {
        setStatus('commands: /task create <title>, /task list, /task cancel <taskId> [reason], /log replay [taskId], /exit')
        return
      }

      if (commandLine === 'exit' || commandLine === 'quit') {
        process.exit(0)
      }

      if (commandLine === 'task list') {
        await refresh()
        setStatus('')
        return
      }

      if (commandLine.startsWith('task create ')) {
        const title = commandLine.slice('task create '.length).trim()
        await app.taskService.createTask({ title, agentId: app.agent.id })
        await refresh()
        setStatus('')
        return
      }

      if (commandLine.startsWith('task cancel ')) {
        const rest = commandLine.slice('task cancel '.length).trim()
        const [taskId, ...reasonParts] = rest.split(/\s+/)
        if (!taskId) {
          setStatus('usage: /task cancel <taskId> [reason]')
          return
        }
        const reason = reasonParts.join(' ').trim() || undefined
        await app.taskService.cancelTask(taskId, reason)
        await refresh()
        setStatus('')
        return
      }

      if (commandLine === 'log replay' || commandLine.startsWith('log replay ')) {
        const rest = commandLine.slice('log replay'.length).trim()
        const streamId = rest ? rest : undefined
        const events = app.eventService.replayEvents(streamId)
        setReplayOutput(events.map((e) => `${e.id} ${e.streamId}#${e.seq} ${e.type} ${JSON.stringify(e.payload)}`))
        setStatus(streamId ? `replayed ${events.length} events for ${streamId}` : `replayed ${events.length} events`)
        return
      }

      setStatus(`unknown: /${commandLine}`)
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e))
    }
  }

  useInput((input, key) => {
    if (key.ctrl && input === 'd') {
      process.exit(0)
    }
  })

  const header = useMemo(() => {
    return `coauthor (store: ${app.storePath})`
  }, [app.storePath])

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Box flexDirection="column" marginBottom={1}>
        <Text bold>{header}</Text>
        <Text dimColor>
          Commands: /task create &lt;title&gt; · /task list · /task cancel &lt;taskId&gt; [reason] · /log replay [taskId] · /exit
        </Text>
      </Box>
      <Box flexDirection="column" marginBottom={1}>
        <Text bold>Tasks</Text>
        {tasks.length === 0 ? <Text dimColor>- (empty)</Text> : null}
        {tasks.map((t) => (
          <Box key={t.taskId}>
            <Text>·</Text>
            <Text> {t.title}</Text>
            <Text dimColor> ({t.taskId})</Text>
          </Box>
        ))}
      </Box>
      {replayOutput.length > 0 ? (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold>Event Log</Text>
          {replayOutput.slice(-10).map((line, i) => (
            <Text key={i} dimColor>{line}</Text>
          ))}
          {replayOutput.length > 10 ? <Text dimColor>... ({replayOutput.length - 10} more)</Text> : null}
        </Box>
      ) : null}
      {status ? (
        <Box marginBottom={1}>
          <Text color="yellow">{status}</Text>
        </Box>
      ) : null}
      <Box>
        <Text color="cyan">{'> '}</Text>
        <TextInput value={input} onChange={setInput} onSubmit={onSubmit} />
      </Box>
    </Box>
  )
}
