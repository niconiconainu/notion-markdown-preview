import * as assert from 'assert';
import * as path from 'path';
import { resolveAssets, isExternalReference } from '../preview/resolveAssets';

const FIXTURES = path.resolve(__dirname, '../../fixtures');

describe('resolveAssets', () => {
  it('resolves a URL-encoded relative path (Notion same-name folder)', () => {
    const baseDir = path.join(FIXTURES, 'notion-export');
    const resolved = resolveAssets('Project%20Plan/image.png', {
      baseDir,
      pageName: 'Project Plan',
    });
    assert.ok(resolved, 'expected a resolved path');
    assert.strictEqual(path.basename(resolved!), 'image.png');
  });

  it('resolves Japanese file names with encoded spaces', () => {
    const baseDir = path.join(FIXTURES, 'japanese-path');
    const resolved = resolveAssets('設計書/画像%201.png', {
      baseDir,
      pageName: '設計書',
    });
    assert.ok(resolved, 'expected a resolved path');
    assert.strictEqual(path.basename(resolved!), '画像 1.png');
  });

  it('returns null for a missing image', () => {
    const baseDir = path.join(FIXTURES, 'notion-export');
    const resolved = resolveAssets('Project%20Plan/nope.png', {
      baseDir,
      pageName: 'Project Plan',
    });
    assert.strictEqual(resolved, null);
  });

  it('returns null for external references', () => {
    const baseDir = path.join(FIXTURES, 'notion-export');
    assert.strictEqual(resolveAssets('https://example.com/a.png', { baseDir }), null);
  });

  it('detects external references', () => {
    assert.ok(isExternalReference('https://example.com/a.png'));
    assert.ok(isExternalReference('data:image/png;base64,AAAA'));
    assert.ok(!isExternalReference('image.png'));
    assert.ok(!isExternalReference('Project%20Plan/image.png'));
  });
});
