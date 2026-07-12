import { Component } from 'react'

// Catches runtime render errors anywhere below it and shows the actual error
// instead of a blank white screen. This makes crashes diagnosable.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null, info: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    this.setState({ info })
    // eslint-disable-next-line no-console
    console.error('Attestr render error:', error, info)
  }

  reset = () => this.setState({ error: null, info: null })

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-[#fafaf8] dark:bg-neutral-950">
        <div className="max-w-2xl w-full bg-white dark:bg-neutral-900 border border-red-200 dark:border-red-500/30 rounded-xl p-6">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500"></span>
            <h1 className="text-[15px] font-semibold text-gray-900 dark:text-white">Something went wrong on this screen</h1>
          </div>
          <p className="text-[12.5px] text-gray-500 dark:text-neutral-400 mb-3">
            The page hit a runtime error. The details below help pinpoint it.
          </p>
          <pre className="text-[11px] font-mono bg-red-50 dark:bg-red-500/5 text-red-700 dark:text-red-400 rounded-lg p-3 overflow-auto max-h-64 whitespace-pre-wrap">
            {String(this.state.error?.message || this.state.error)}
            {this.state.info?.componentStack ? '\n\nComponent stack:' + this.state.info.componentStack : ''}
          </pre>
          <div className="flex gap-2 mt-4">
            <button onClick={this.reset}
              className="text-[12.5px] font-semibold bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg">
              Try again
            </button>
            <button onClick={() => { window.location.href = '/' }}
              className="text-[12.5px] font-medium border border-gray-200 dark:border-neutral-700 px-4 py-2 rounded-lg text-gray-600 dark:text-neutral-300">
              Go home
            </button>
          </div>
        </div>
      </div>
    )
  }
}
