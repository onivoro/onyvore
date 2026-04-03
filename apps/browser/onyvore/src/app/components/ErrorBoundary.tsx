import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[Onyvore] React error boundary caught:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="ony-error">
          <div className="ony-error__title">Onyvore encountered an error:</div>
          <pre className="ony-error__detail">
            {this.state.error.message}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}
