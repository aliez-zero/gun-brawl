import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import { createDeepSeekGateway } from '../server/ai/deepseek.mjs';

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  const gateway = () => createDeepSeekGateway({
    apiKey: env.DEEPSEEK_API_KEY, model: env.DEEPSEEK_MODEL,
    maxRequests: env.DEEPSEEK_MAX_REQUESTS, requestIntervalMs: env.DEEPSEEK_INTERVAL_MS,
    timeoutMs: env.DEEPSEEK_TIMEOUT_MS, contextTokens: env.DEEPSEEK_CONTEXT_TOKENS,
    thinking: env.DEEPSEEK_THINKING, reasoningEffort: env.DEEPSEEK_REASONING_EFFORT,
  });
  return {
  plugins: [{
    name: 'local-deepseek-gateway',
    configureServer(server) {
      const handler = gateway();
      server.middlewares.use('/api/deepseek', handler);
      server.httpServer?.once('close', () => handler.close());
    },
    configurePreviewServer(server) {
      const handler = gateway();
      server.middlewares.use('/api/deepseek', handler);
      server.httpServer.once('close', () => handler.close());
    },
  }],
  base: './',
  server: {
    // The Rust room server owns the WebSocket; DeepSeek stays a local middleware.
    proxy: { '/ws': { target: 'ws://127.0.0.1:8080', ws: true } },
    // Browser evidence and parallel helpers can be written atomically on Windows.
    // They are not application inputs and must not interrupt the dev watcher.
    watch: { ignored: ['**/artifacts/**', '**/*.tmp', '**/*.tmpdir', '**/*.tmpdir/**'] },
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
  };
});
