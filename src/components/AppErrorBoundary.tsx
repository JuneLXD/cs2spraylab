import { Component, ErrorInfo, ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { error?: Error };

export class AppErrorBoundary extends Component<Props, State> {
  state: State = {};

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('SprayLab UI crashed safely:', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <main className="sl-error-page">
        <section className="sl-error-card">
          <p >Recovered from a UI error</p>
          <h1 >The trainer hit a runtime error instead of going black.</h1>
          <p >
            Refresh the page to continue. Your local progress is kept when possible. Open the browser console and send the red error text if this happens again.
          </p>
          <pre >
            {this.state.error.message}
          </pre>
          <button className="sl-button sl-button-primary" onClick={() => window.location.reload()}>
            Reload trainer
          </button>
        </section>
      </main>
    );
  }
}
