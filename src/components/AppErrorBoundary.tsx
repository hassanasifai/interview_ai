import { Component, type ErrorInfo, type ReactNode } from 'react';
import { logger } from '../lib/logger';

type Props = {
  children: ReactNode;
};

type State = {
  hasError: boolean;
};

export class AppErrorBoundary extends Component<Props, State> {
  override state: State = {
    hasError: false,
  };

  static getDerivedStateFromError() {
    return {
      hasError: true,
    };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    logger.error('react.boundary', 'Unhandled app error', {
      message: error.message,
      stack: error.stack ?? '',
      component_stack: info.componentStack ?? '',
    });
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '2rem', color: '#f3efe9' }}>
          <h1>MeetingMind recovered from an unexpected error</h1>
          <p>Please refresh the app. Local data remains on this device.</p>
        </div>
      );
    }

    return this.props.children;
  }
}
