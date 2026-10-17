import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      output: { manualChunks: { phaser: ['phaser'] } },
    },
    // Phaser is an intentionally separate engine bundle.
    chunkSizeWarningLimit: 1500,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: { include: ['src/game/**', 'src/storage/**'] },
  },
});
