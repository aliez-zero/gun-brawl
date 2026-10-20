import { createServer } from 'node:http';
import { createDeepSeekGateway } from './deepseek.mjs';

/**
 * Standalone wrapper for the Vite middleware so the DeepSeek gateway can run as
 * a sidecar container behind Caddy. It is only reachable on the compose network.
 */
const port = Number(process.env.PORT ?? 8090);
const prefix = '/api/deepseek';

const gateway = createDeepSeekGateway({
  apiKey: process.env.DEEPSEEK_API_KEY,
  model: process.env.DEEPSEEK_MODEL,
  maxRequests: process.env.DEEPSEEK_MAX_REQUESTS,
  requestIntervalMs: process.env.DEEPSEEK_INTERVAL_MS,
  timeoutMs: process.env.DEEPSEEK_TIMEOUT_MS,
  contextTokens: process.env.DEEPSEEK_CONTEXT_TOKENS,
  thinking: process.env.DEEPSEEK_THINKING,
  reasoningEffort: process.env.DEEPSEEK_REASONING_EFFORT,
});

const server = createServer((req, res) => {
  const url = req.url ?? '/';
  if (!url.startsWith(prefix)) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end('{"error":"NOT_FOUND"}');
    return;
  }
  req.url = url.slice(prefix.length) || '/';
  // The gateway's localhost guard protects the Vite dev server; in production it
  // sits on a private network behind Caddy, so present a local same-origin view.
  req.headers.host = `localhost:${port}`;
  if (req.headers.origin) req.headers.origin = `http://localhost:${port}`;
  gateway(req, res, () => {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end('{"error":"NOT_FOUND"}');
  });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`deepseek gateway listening on :${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    gateway.close?.();
    server.close(() => process.exit(0));
  });
}
