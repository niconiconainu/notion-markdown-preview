import * as assert from 'assert';
import { getNonce } from '../preview/getNonce';

describe('getNonce', () => {
  it('returns a non-empty hex string', () => {
    const nonce = getNonce();
    assert.ok(nonce.length >= 16);
    assert.match(nonce, /^[0-9a-f]+$/);
  });

  it('returns a different value on each call', () => {
    const values = new Set(Array.from({ length: 50 }, () => getNonce()));
    assert.strictEqual(values.size, 50);
  });
});
