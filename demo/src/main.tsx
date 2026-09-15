import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import '@fileverse/ui/styles/base';
import 'katex/dist/katex.min.css';
import App from './App.tsx';
import { ThemeProvider } from '@fileverse/ui';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </React.StrictMode>,
);
