import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 2542,
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:2540',
        changeOrigin: true
      }
    }
  }
});
