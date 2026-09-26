import { Component, type ErrorInfo, type ReactNode } from 'react'

// Catches a crash in part of the page so the rest keeps working.

type Props = {
  /** Shown instead of the children after a crash. Gets a retry that remounts them. */
  fallback: (retry: () => void) => ReactNode
  /** Short name for the console, like "map". */
  name: string
  children: ReactNode
}

type State = { failed: boolean; attempt: number }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, attempt: 0 }

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.name}] crashed`, error, info.componentStack)
  }

  private retry = () => this.setState((s) => ({ failed: false, attempt: s.attempt + 1 }))

  render() {
    if (this.state.failed) return this.props.fallback(this.retry)
    // A new key on retry gives the children a fresh start.
    return <div key={this.state.attempt} style={{ display: 'contents' }}>{this.props.children}</div>
  }
}
