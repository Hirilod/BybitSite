import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true
      },
      '/health': {
        target: 'http://localhost:4000',
        changeOrigin: true
      }
    },
    allowedHosts: [
      "dfgfdgfdgf.ai-medgpt.store"
    ]
  },
  preview: {
    port: 4173
  },
  build: {
    sourcemap: true
  },
  plugins: [react()]
});

