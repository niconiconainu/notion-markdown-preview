import * as assert from 'assert';
import { parseUnifiedDiff, intersectsRanges } from '../preview/gitDiff';

describe('parseUnifiedDiff', () => {
  it('classifies pure additions', () => {
    const out = parseUnifiedDiff('@@ -10,0 +11,3 @@ context\n+a\n+b\n+c\n');
    assert.deepStrictEqual(out.added, [[10, 12]]);
    assert.deepStrictEqual(out.modified, []);
    assert.deepStrictEqual(out.deleted, []);
  });

  it('classifies modifications and keeps the replaced content', () => {
    const out = parseUnifiedDiff('@@ -5,2 +5,2 @@\n-x\n-y\n+X\n+Y\n');
    assert.deepStrictEqual(out.modified, [[4, 5]]);
    assert.deepStrictEqual(out.added, []);
    assert.deepStrictEqual(out.deleted, [{ line: 4, text: 'x\ny', pure: false }]);
  });

  it('captures deleted content with its position', () => {
    const out = parseUnifiedDiff('@@ -8,2 +7,0 @@\n-gone one\n-gone two\n');
    assert.deepStrictEqual(out.deleted, [{ line: 7, text: 'gone one\ngone two', pure: true }]);
  });

  it('handles single-line hunks without an explicit count', () => {
    const out = parseUnifiedDiff('@@ -3 +3 @@\n-a\n+b\n');
    assert.deepStrictEqual(out.modified, [[2, 2]]);
  });

  it('handles a deletion at the top of the file', () => {
    const out = parseUnifiedDiff('@@ -1,2 +0,0 @@\n-a\n-b\n');
    assert.deepStrictEqual(out.deleted, [{ line: 0, text: 'a\nb', pure: true }]);
  });

  it('keeps deleted lines that start with a dash', () => {
    const out = parseUnifiedDiff('@@ -4,1 +3,0 @@\n-- a list item\n');
    assert.deepStrictEqual(out.deleted[0].text, '- a list item');
  });

  it('does not leak file headers into deleted content', () => {
    const out = parseUnifiedDiff(
      'diff --git a/f.md b/f.md\n--- a/f.md\n+++ b/f.md\n@@ -2,1 +1,0 @@\n-only this\n',
    );
    assert.deepStrictEqual(out.deleted, [{ line: 1, text: 'only this', pure: true }]);
  });

  it('parses multiple hunks', () => {
    const out = parseUnifiedDiff(
      '@@ -1,1 +1,1 @@\n-a\n+A\n@@ -9,0 +10,2 @@\n+n\n+m\n@@ -20,3 +21,0 @@\n-x\n-y\n-z\n',
    );
    assert.deepStrictEqual(out.modified, [[0, 0]]);
    assert.deepStrictEqual(out.added, [[9, 10]]);
    assert.deepStrictEqual(out.deleted, [
      { line: 0, text: 'a', pure: false },
      { line: 21, text: 'x\ny\nz', pure: true },
    ]);
  });

  it('returns empty ranges for an empty diff', () => {
    assert.deepStrictEqual(parseUnifiedDiff(''), { added: [], modified: [], deleted: [] });
  });
});

describe('intersectsRanges', () => {
  it('detects overlap with a block range [start, end)', () => {
    assert.strictEqual(intersectsRanges(5, 10, [[9, 12]]), true);
    assert.strictEqual(intersectsRanges(5, 10, [[10, 12]]), false); // end is exclusive
    assert.strictEqual(intersectsRanges(5, 10, [[0, 4]]), false);
    assert.strictEqual(intersectsRanges(5, 10, [[0, 5]]), true);
  });
});
