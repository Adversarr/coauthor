import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Toaster } from 'sonner'
import { App } from './App'
import { ErrorBoundary } from './components/display/ErrorBoundary'
import { useConnectionStore } from './stores/connectionStore'
import './index.css'
import './notifications'

// Connect to WebSocket on startup
useConnectionStore.getState().connect()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
      <Toaster
        position="bottom-right"
        theme="dark"
        richColors
        closeButton
        toastOptions={{ className: 'font-sans' }}
      />
    </ErrorBoundary>
  </StrictMode>,
)
