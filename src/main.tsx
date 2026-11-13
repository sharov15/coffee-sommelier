import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/manrope';
import '@fontsource/playfair-display/cyrillic-600.css';
import '@fontsource/playfair-display/latin-600.css';
import '@fontsource/playfair-display/cyrillic-600-italic.css';
import '@fontsource/playfair-display/latin-600-italic.css';
import { App } from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
