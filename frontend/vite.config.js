import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Force all packages to use the SAME copy of React — fixes @deck.gl/react
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    // Pre-bundle deck.gl packages together so they share one React instance
    include: [
      'react',
      'react-dom',
      'deck.gl',
      '@deck.gl/react',
      '@deck.gl/core',
      '@deck.gl/layers',
      '@deck.gl/geo-layers',
    ],
  },
});
