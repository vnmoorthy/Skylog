/**
 * SKYLOG — root error boundary.
 *
 * Wraps <App /> so that an uncaught render error doesn't show a blank
 * page. Instead the user gets a clean "something broke, please reload"
 * card with the error message — no telemetry, just a recovery button.
 */

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  err: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { err: null };

  static getDerivedStateFromError(err: Error): State {
    return { err };
  }

  componentDidCatch(err: Error): void {
    // eslint-disable-next-line no-console
    console.error("Skylog crashed:", err);
  }

  reset = (): void => {
    this.setState({ err: null });
  };

  render(): ReactNode {
    if (this.state.err) {
      return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950 p-6 text-ink-100">
          <div className="max-w-md rounded border border-ink-700 bg-ink-900 p-6">
            <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-accent">
              skylog crashed
            </p>
            <h1 className="mt-2 text-lg font-semibold">Something broke.</h1>
            <p className="mt-2 text-sm text-ink-300">
              Reloading usually fixes it. If it persists, please open an issue
              with the message below.
            </p>
            <pre className="mt-3 max-h-40 overflow-auto rounded bg-ink-950 p-2 font-mono text-[11px] text-ink-300">
              {this.state.err.message}
            </pre>
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => window.location.reload()}
                className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-ink-950 hover:bg-accent-soft"
              >
                Reload
              </button>
              <button
                onClick={this.reset}
                className="rounded border border-ink-700 px-3 py-1.5 text-sm text-ink-300 hover:border-ink-500"
              >
                Try again without reload
              </button>
              <a
                href="https://github.com/vnmoorthy/Skylog/issues/new"
                target="_blank"
                rel="noreferrer"
                className="ml-auto self-center font-mono text-[10px] uppercase tracking-wider text-ink-400 hover:text-accent"
              >
                report issue ↗
              </a>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
