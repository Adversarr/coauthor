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
        <Badge className="gap-1.5 bg-emerald-900/60 text-emerald-200 border-transparent">
          <Wifi size={14} />
          Connected
        </Badge>
      )
    case 'connecting':
      return (
        <Badge className="gap-1.5 bg-amber-900/60 text-amber-200 border-transparent">
          <Loader2 size={14} className="animate-spin" />
          Connecting
        </Badge>
      )
    case 'disconnected':
      return (
        <Badge className="gap-1.5 bg-red-900/60 text-red-200 border-transparent">
          <WifiOff size={14} />
          Disconnected
        </Badge>
      )
  }
}
