import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/trade-investigator/',  // Change to your repo name
  build: {
    outDir: '../docs',  // GitHub Pages serves from /docs
    emptyOutDir: true,
  },
});
