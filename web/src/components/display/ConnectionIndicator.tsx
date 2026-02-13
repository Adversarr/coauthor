/**
 * ConnectionIndicator — shows WebSocket connection status in the header.
 */

import { Wifi, WifiOff, Loader2 } from 'lucide-react'
import { useConnectionStore } from '@/stores'
import { Badge } from '@/components/ui/badge'

export function ConnectionIndicator() {
  const status = useConnectionStore(s => s.status)

  switch (status) {
    case 'connected':
      return (
        <Badge className="gap-1.5 border-emerald-500/40 bg-emerald-500/15 text-emerald-200">
          <Wifi size={14} />
          Connected
        </Badge>
      )
    case 'connecting':
      return (
        <Badge className="gap-1.5 border-amber-500/40 bg-amber-500/15 text-amber-200">
          <Loader2 size={14} className="animate-spin" />
          Connecting
        </Badge>
      )
    case 'disconnected':
      return (
        <Badge className="gap-1.5 border-destructive/40 bg-destructive/15 text-destructive">
          <WifiOff size={14} />
          Disconnected
        </Badge>
      )
  }
}
