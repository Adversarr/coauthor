/**
 * ErrorBoundary — catches React rendering errors and shows a recovery UI.
 *
 * Prevents the "white screen of death" when any child component crashes.
 * Provides a user-friendly fallback with reload and detailed error info.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null, errorInfo: null }
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo })
    console.error('[ErrorBoundary] Uncaught error:', error, errorInfo)
  }

  handleReload = (): void => {
    window.location.reload()
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null, errorInfo: null })
  }

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback

      return (
        <div className="flex min-h-full items-center justify-center bg-zinc-950 p-8">
          <div className="max-w-md w-full space-y-6 text-center">
            <div className="flex justify-center">
              <div className="rounded-full bg-red-900/30 p-4">
                <AlertTriangle className="h-10 w-10 text-red-400" />
              </div>
            </div>
            <div>
              <h1 className="text-xl font-bold text-zinc-100">Something went wrong</h1>
              <p className="mt-2 text-sm text-zinc-400">
                An unexpected error crashed the UI. You can try reloading the page.
              </p>
            </div>
            {this.state.error && (
              <pre className="rounded-lg bg-zinc-900 border border-zinc-800 p-4 text-left text-xs text-red-300 overflow-x-auto max-h-40 overflow-y-auto">
                {this.state.error.message}
              </pre>
            )}
            <div className="flex justify-center gap-3">
              <button
                onClick={this.handleReset}
                className="rounded-md bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-700 transition-colors"
              >
                Try Again
              </button>
              <button
                onClick={this.handleReload}
                className="inline-flex items-center gap-2 rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 transition-colors"
              >
                <RotateCcw className="h-4 w-4" />
                Reload Page
              </button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
