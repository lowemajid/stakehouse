import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import '@stakehouse/theme/tokens.css';
import './styles/fonts.css';
import './styles.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('#root element missing from index.html');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
