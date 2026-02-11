/**
 * Settings page — connection settings and configuration.
 */

import { useEffect, useRef, useState } from 'react'
import { useConnectionStore } from '@/stores'

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

      <div className="space-y-4 max-w-md">
        <div>
          <label className="block text-sm text-zinc-400 mb-1">Auth Token</label>
          <input
            type="password"
            value={token}
            onChange={e => setToken(e.target.value)}
            placeholder="Paste your auth token…"
            className="w-full rounded-md bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-violet-500 font-mono"
          />
          <p className="text-xs text-zinc-600 mt-1">
            The token is shown when the server starts (in the terminal output).
          </p>
        </div>

        <button
          onClick={saveToken}
          className="px-4 py-2 rounded-md bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition-colors"
        >
          Save & Reconnect
        </button>

        {saveStatus === 'saved' && (
          <p className="text-xs text-emerald-400">Token saved. Reconnecting…</p>
        )}
        {saveStatus === 'error' && (
          <p className="text-xs text-red-400">Failed to save token (storage may be restricted).</p>
        )}

        <div className="pt-4 border-t border-zinc-800">
          <p className="text-sm text-zinc-500">
            Connection status: <strong className="text-zinc-300">{status}</strong>
          </p>
        </div>
      </div>
    </div>
  )
}
