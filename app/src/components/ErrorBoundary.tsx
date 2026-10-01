import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

// The stream lives above this boundary (in App), so a render crash in the
// list doesn't stop it, and "Try again" shows what arrived meanwhile.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  private handleReset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return (
        <div
          role="alert"
          className="h-full flex flex-col items-center justify-center gap-3 text-center font-mono text-sm text-gray-400 p-8"
        >
          <p className="text-red-400">
            Something went wrong rendering the stream.
          </p>
          <p className="text-xs text-gray-600">{this.state.error.message}</p>
          <button
            type="button"
            onClick={this.handleReset}
            className="text-xs px-3 py-1.5 rounded border border-gray-600 text-gray-300 hover:border-gray-400 transition-colors"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
