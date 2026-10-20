import { spawnSync } from 'node:child_process';
import { copyFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const serverDir = resolve(here, '../../server');
const result = spawnSync(
  'cargo',
  ['build', '-p', 'gunbrawl-predict', '--target', 'wasm32-unknown-unknown', '--release'],
  { cwd: serverDir, stdio: 'inherit' },
);
if (result.status !== 0) {
  console.error('cargo build failed; install the target with `rustup target add wasm32-unknown-unknown`');
  process.exit(result.status ?? 1);
}
const source = resolve(serverDir, 'target/wasm32-unknown-unknown/release/gunbrawl_predict.wasm');
const target = resolve(here, '../public/predict.wasm');
copyFileSync(source, target);
console.log(`predict.wasm updated (${target})`);
