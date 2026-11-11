import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Byte identity of files copied unchanged from aumara-xyz/aukora-kernel
// b441edc4d17de778d30ae955f46408edae39bffe (wolf blobs imported in
// 3ab134094668d09cb870d317a358292d9708d028). Path-rewritten files are excluded.
const SHA256: Record<string, string> = {
  'packages/engines/wolf-ledger.js': 'efcc4595d64d3440b6cbc18e9d897f067619f1ac0dbef4773cc65a20fa75c2d5',
  'packages/engines/wolf-market.js': 'fd3c94efe7bec44323215723fa085fd9aa5c3ddf019c7d3308a8b5f21001da70',
  'packages/engines/wolf-lab.js': 'eb9a161434520f24eab70fd7f55efcef9439d5afe0d24893b7e6c63de9da516e',
  'packages/engines/wolf-live.js': '992eda090af0000f7cfe17264d3427f7d80c4bd0cc2dc09829bd4558fd2105a9',
  'packages/engines/wolf-mind-env.js': 'a8e12fedd08b1ce157f576a1e20da4857442f72d2099821df60f68b9676a3728',
  'packages/engines/wolf-mind-story.js': '9344bf9db65117e4b1501dd38f4959afbbe19491fd56d17673a69276fc97958c',
  'packages/engines/vendor/arc3/mind.js': 'b10889df2a4c71f9015399896588fc32793951dfa0a7e6a0c2424076c124d89a',
  'packages/engines/vendor/arc3/engine.js': 'f7da7d3c6ed8661dfb38b54be835fa78a5cbcb6037ba6ee88a761e929ddb4eee',
};

describe('extract identity', () => {
  it('unchanged engine bytes match the public kernel snapshot', () => {
    for (const [rel, expected] of Object.entries(SHA256)) {
      const buf = fs.readFileSync(path.join(root, rel));
      const got = crypto.createHash('sha256').update(buf).digest('hex');
      expect(got, rel).toBe(expected);
    }
  });

  it('ported engines keep the AGPL header', () => {
    const src = fs.readFileSync(path.join(root, 'packages/engines/wolf-ledger.js'), 'utf8');
    expect(src.startsWith('// SPDX-License-Identifier: AGPL-3.0-or-later')).toBe(true);
  });
});
