import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import '@fileverse/ui/styles/base';
import 'katex/dist/katex.min.css';
import App from './App.tsx';
import { ThemeProvider } from '@fileverse/ui';
import { PalmAtmosphere } from './components/palm-atmosphere/palm-atmosphere';
import {
  PalmTuningPanel,
  PalmTuningProvider,
} from './components/palm-atmosphere/palm-tuning';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <PalmTuningProvider>
        <App />
        <PalmAtmosphere />
        <PalmTuningPanel />
      </PalmTuningProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
