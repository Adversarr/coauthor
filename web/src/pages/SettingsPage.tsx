/**
 * Settings page — connection settings and configuration.
 */

import { useEffect, useRef, useState } from 'react'
import { useConnectionStore } from '@/stores'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function SettingsPage() {
  const status = useConnectionStore(s => s.status)
  const connect = useConnectionStore(s => s.connect)
  const disconnect = useConnectionStore(s => s.disconnect)
  const [token, setToken] = useState(sessionStorage.getItem('coauthor-token') ?? '')
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle')
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current)
    }
  }, [])

  const saveToken = () => {
    try {
      sessionStorage.setItem('coauthor-token', token)
    } catch {
      setSaveStatus('error')
      return
    }
    disconnect()
    // Wait for disconnect to settle before reconnecting
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current)
    reconnectTimerRef.current = setTimeout(() => {
      connect()
      setSaveStatus('saved')
      statusTimerRef.current = setTimeout(() => setSaveStatus('idle'), 2000)
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
            <Label htmlFor="coauthor-token">Auth Token</Label>
            <Input
              id="coauthor-token"
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
            <Button onClick={saveToken}>Save & Reconnect</Button>
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
    </div>
  )
}
