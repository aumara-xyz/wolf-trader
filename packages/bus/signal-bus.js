// Signal bus: append-only JSONL files are the default.
// A Redis-shaped client can mirror the same records. Files stay the
// source of truth. Records that carry wallet or API secrets are refused.

import fs from 'node:fs';
import path from 'node:path';

const BANNED_KEYS = new Set([
  'privatekey',
  'mnemonic',
  'apikey',
  'apisecret',
  'walletseed',
  'authorization',
  'seedphrase',
  'secret',
  'password',
]);

export function assertNoSecrets(value, trail = '') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (BANNED_KEYS.has(key.toLowerCase())) {
      throw new Error(`refusing field ${trail}${key}: wallets and API secrets do not enter the bus`);
    }
    assertNoSecrets(child, `${trail}${key}.`);
  }
}

export function createFileSignalBus(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return {
    kind: 'file',
    dir,
    async append(stream, record) {
      assertNoSecrets(record);
      const file = path.join(dir, `${stream}.jsonl`);
      fs.appendFileSync(file, `${JSON.stringify(record)}\n`);
    },
    async read(stream) {
      const file = path.join(dir, `${stream}.jsonl`);
      if (!fs.existsSync(file)) return [];
      const raw = fs.readFileSync(file, 'utf8').trim();
      if (!raw) return [];
      return raw.split('\n').filter(Boolean).map((line) => JSON.parse(line));
    },
  };
}

export function createRedisSignalBus(client, prefix = 'aukora-wolf') {
  return {
    kind: 'redis',
    async append(stream, record) {
      assertNoSecrets(record);
      await client.rpush(`${prefix}:${stream}`, JSON.stringify(record));
    },
    async read(stream) {
      const rows = await client.lrange(`${prefix}:${stream}`, 0, -1);
      return rows.map((line) => JSON.parse(line));
    },
  };
}

export function createSignalBus({ dir, redis = null, prefix = 'aukora-wolf' } = {}) {
  if (!dir) throw new Error('signal bus needs a directory — files are the default');
  const file = createFileSignalBus(dir);
  if (!redis) return file;
  const mirror = createRedisSignalBus(redis, prefix);
  return {
    kind: 'file+redis',
    dir,
    async append(stream, record) {
      await file.append(stream, record);
      await mirror.append(stream, record);
    },
    async read(stream) {
      return file.read(stream);
    },
  };
}
