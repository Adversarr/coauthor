import React, { useEffect, useMemo, useState } from 'react'
import { Box, Text, useInput } from 'ink'
import TextInput from 'ink-text-input'
import type { App } from '../app/createApp.js'
import { createTask, listTasks, openThread, replayEvents } from '../core/operations.js'

type Props = {
  app: App
}

export function MainTui(props: Props) {
  const { app } = props
  const [input, setInput] = useState('')
  const [status, setStatus] = useState<string>('')
  const [tasks, setTasks] = useState<Array<{ taskId: string; title: string }>>([])
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null)

  const refresh = async () => {
    const state = await listTasks(app.store)
    setTasks(state.tasks.map((t) => ({ taskId: t.taskId, title: t.title })))
    setCurrentTaskId(state.currentTaskId)
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
        setStatus('commands: /task create <title>, /task list, /thread open <taskId>, /log replay [taskId], /exit')
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
        await createTask(app.store, title)
        await refresh()
        setStatus('')
        return
      }

      if (commandLine.startsWith('thread open ')) {
        const taskId = commandLine.slice('thread open '.length).trim()
        await openThread(app.store, taskId)
        await refresh()
        setStatus(`opened ${taskId}`)
        return
      }

      if (commandLine === 'log replay' || commandLine.startsWith('log replay ')) {
        const rest = commandLine.slice('log replay'.length).trim()
        const streamId = rest ? rest : undefined
        const events = replayEvents(app.store, streamId)
        for (const e of events) {
          console.log(`${e.id} ${e.streamId}#${e.seq} ${e.type} ${JSON.stringify(e.payload)}`)
        }
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
    return `coauthor (db: ${app.dbPath})`
  }, [app.dbPath])

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Box flexDirection="column" marginBottom={1}>
        <Text bold>{header}</Text>
        <Text dimColor>
          Commands: /task create &lt;title&gt; · /task list · /thread open &lt;taskId&gt; · /log replay [taskId] · /exit
        </Text>
      </Box>
      <Box flexDirection="column" marginBottom={1}>
        <Text bold>Tasks</Text>
        {tasks.length === 0 ? <Text dimColor>- (empty)</Text> : null}
        {tasks.map((t) => (
          <Box key={t.taskId}>
            <Text color={t.taskId === currentTaskId ? 'green' : undefined}>
              {t.taskId === currentTaskId ? '•' : '·'}
            </Text>
            <Text> {t.title}</Text>
            <Text dimColor> ({t.taskId})</Text>
          </Box>
        ))}
      </Box>
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
