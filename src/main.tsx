import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './range/RangeApp';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import './range/ui/fonts.css';
import './range/ui/tokens.css';
import './range/range.css';
import './range/ui/primitives.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>
);
