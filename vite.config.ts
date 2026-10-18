import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  server: {
    // Browser evidence and parallel helpers can be written atomically on Windows.
    // They are not application inputs and must not interrupt the dev watcher.
    watch: { ignored: ['**/artifacts/**'] },
  },
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
