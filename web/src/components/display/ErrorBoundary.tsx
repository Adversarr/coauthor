/**
 * ErrorBoundary — catches React rendering errors and shows a recovery UI.
 *
 * Prevents the "white screen of death" when any child component crashes.
 * Provides a user-friendly fallback with reload and detailed error info.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

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
        <div className="flex min-h-full items-center justify-center bg-background p-8">
          <Card className="w-full max-w-md border-border bg-card/95">
            <CardHeader className="items-center space-y-4 text-center">
              <div className="rounded-full bg-destructive/15 p-4">
                <AlertTriangle className="h-10 w-10 text-destructive" />
              </div>
              <CardTitle className="text-xl">Something went wrong</CardTitle>
            <CardDescription>
              An unexpected error crashed the UI. You can try reloading the page.
            </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {this.state.error && (
                <pre className="max-h-40 overflow-auto rounded-lg border border-border bg-muted/40 p-4 text-left text-xs text-destructive">
                  {this.state.error.message}
                </pre>
              )}
              <div className="flex justify-center gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={this.handleReset}
                >
                  Try Again
                </Button>
                <Button
                  type="button"
                  onClick={this.handleReload}
                >
                  <RotateCcw className="h-4 w-4" />
                  Reload Page
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )
    }

    return this.props.children
  }
}
