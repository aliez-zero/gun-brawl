import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomId } from '../src/ids';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => vi.unstubAllGlobals());

describe('randomId', () => {
  it('returns a v4 UUID where crypto.randomUUID exists', () => {
    expect(randomId()).toMatch(UUID_V4);
  });

  it('falls back to getRandomValues outside a secure context', () => {
    // Plain http:// deployments have crypto but no randomUUID.
    vi.stubGlobal('crypto', {
      getRandomValues: (buffer: Uint8Array) => {
        for (let index = 0; index < buffer.length; index++) buffer[index] = index * 7;
        return buffer;
      },
    });
    expect(randomId()).toMatch(UUID_V4);
  });

  it('falls back to Math.random when no crypto is available at all', () => {
    vi.stubGlobal('crypto', undefined);
    expect(randomId()).toMatch(UUID_V4);
  });

  it('does not repeat', () => {
    const ids = new Set(Array.from({ length: 500 }, () => randomId()));
    expect(ids.size).toBe(500);
  });
});
