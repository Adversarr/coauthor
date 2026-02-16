/**
 * Settings page — connection settings, keyboard shortcuts, and runtime info.
 */

import { useEffect, useRef, useState } from 'react'
import { useConnectionStore, useRuntimeStore } from '@/stores'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Kbd } from '@/components/display/Kbd'

export function SettingsPage() {
  const status = useConnectionStore(s => s.status)
  const connect = useConnectionStore(s => s.connect)
  const disconnect = useConnectionStore(s => s.disconnect)
  const [token, setToken] = useState(sessionStorage.getItem('seed-token') ?? '')
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle')
  const [isReconnecting, setIsReconnecting] = useState(false)
  const isReconnectingRef = useRef(false)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current)
      isReconnectingRef.current = false
    }
  }, [])

  const saveToken = () => {
    if (isReconnectingRef.current) return
    isReconnectingRef.current = true
    setIsReconnecting(true)
    try {
      sessionStorage.setItem('seed-token', token)
    } catch {
      setSaveStatus('error')
      setIsReconnecting(false)
      isReconnectingRef.current = false
      return
    }
    disconnect()
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current)
    reconnectTimerRef.current = setTimeout(() => {
      connect()
      setSaveStatus('saved')
      statusTimerRef.current = setTimeout(() => {
        setSaveStatus('idle')
        setIsReconnecting(false)
        isReconnectingRef.current = false
      }, 2000)
    }, 200)
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-zinc-100">Settings</h1>

      <Card className="max-w-md bg-zinc-950/40">
        <CardHeader>
          <CardTitle>Connection</CardTitle>
          <CardDescription>Configure the token used for API and WebSocket auth.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="seed-token">Auth Token</Label>
            <Input
              id="seed-token"
              type="password"
              value={token}
              onChange={e => setToken(e.target.value)}
              placeholder="Paste your auth token…"
              className="font-mono"
            />
            <p className="text-xs text-zinc-500">
              The token is shown when the server starts (in the terminal output).
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Button onClick={saveToken} disabled={isReconnecting}>
              {isReconnecting ? 'Reconnecting…' : 'Save & Reconnect'}
            </Button>
            <p className="text-sm text-zinc-500">
              Status: <span className="text-zinc-200">{status}</span>
            </p>
          </div>

          {saveStatus === 'saved' && (
            <p className="text-xs text-emerald-400">Token saved. Reconnecting…</p>
          )}
          {saveStatus === 'error' && (
            <p className="text-xs text-red-400">Failed to save token (storage may be restricted).</p>
          )}
        </CardContent>
      </Card>

      {/* Keyboard Shortcuts */}
      <Card className="max-w-md bg-zinc-950/40">
        <CardHeader>
          <CardTitle>Keyboard Shortcuts</CardTitle>
          <CardDescription>Navigate quickly with vim-style shortcuts.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 text-sm">
            <ShortcutRow keys={['⌘', 'N']} desc="New task" />
            <ShortcutRow keys={['Esc']} desc="Go back" />
            <ShortcutRow keys={['g', 'h']} desc="Go to dashboard" />
            <ShortcutRow keys={['g', 'a']} desc="Go to activity" />
            <ShortcutRow keys={['g', 's']} desc="Go to settings" />
          </div>
        </CardContent>
      </Card>

      {/* Runtime Info */}
      <RuntimeInfoCard />
    </div>
  )
}

function ShortcutRow({ keys, desc }: { keys: string[]; desc: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-zinc-400">{desc}</span>
      <div className="flex items-center gap-1">
        {keys.map((k, i) => (
          <Kbd key={i}>{k}</Kbd>
        ))}
      </div>
    </div>
  )
}

function RuntimeInfoCard() {
  const agents = useRuntimeStore(s => s.agents)
  const fetchRuntime = useRuntimeStore(s => s.fetchRuntime)
  const defaultAgentId = useRuntimeStore(s => s.defaultAgentId)

  useEffect(() => {
    const controller = new AbortController()
    fetchRuntime({ signal: controller.signal })
    return () => controller.abort()
  }, [fetchRuntime])

  return (
    <Card className="max-w-md bg-zinc-950/40">
      <CardHeader>
        <CardTitle>Runtime</CardTitle>
        <CardDescription>Connected agent information.</CardDescription>
      </CardHeader>
      <CardContent>
        {agents.length === 0 ? (
          <p className="text-xs text-zinc-500 italic">No agents registered.</p>
        ) : (
          <div className="space-y-2">
            {agents.map(a => (
              <div key={a.id} className="flex items-center gap-2 text-sm">
                <span className="text-zinc-300">{a.displayName ?? a.id}</span>
                {a.id === defaultAgentId && (
                  <span className="text-[10px] text-violet-400 bg-violet-950/40 px-1.5 rounded">default</span>
                )}
                {a.description && (
                  <span className="text-xs text-zinc-600 truncate">{a.description}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
