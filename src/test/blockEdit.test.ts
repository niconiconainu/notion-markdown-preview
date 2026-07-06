import * as assert from 'assert';
import { moveBlock, replaceLines, toggleTaskLine } from '../preview/blockEdit';

describe('moveBlock', () => {
  it('reorders two paragraphs (move second before first)', () => {
    const text = 'A\n\nB\n';
    // Block "B" is at lines [2,3); move it before line 0.
    const out = moveBlock(text, 2, 3, 0);
    assert.strictEqual(out, 'B\n\nA\n');
  });

  it('moves a block to the end', () => {
    const text = 'A\n\nB\n\nC\n';
    // Move "A" (lines [0,1)) to the end (large target → append).
    const out = moveBlock(text, 0, 1, Number.MAX_SAFE_INTEGER);
    assert.strictEqual(out, 'B\n\nC\n\nA\n');
  });

  it('moves a multi-line heading+body block as a unit', () => {
    const text = '# One\n\nbody one\n\n# Two\n\nbody two\n';
    // Move the "# Two" section (lines [4,7)) before "# One" (line 0).
    const out = moveBlock(text, 4, 7, 0);
    assert.strictEqual(out, '# Two\n\nbody two\n\n# One\n\nbody one\n');
  });

  it('preserves frontmatter and uses file-absolute line numbers', () => {
    const text = '---\ntitle: x\n---\n\n# Heading\n\npara A\n\npara B\n';
    // Lines: 0:--- 1:title 2:--- 3:'' 4:# Heading 5:'' 6:para A 7:'' 8:para B
    // Move "para B" (lines [8,9)) before "para A" (line 6).
    const out = moveBlock(text, 8, 9, 6);
    assert.strictEqual(out, '---\ntitle: x\n---\n\n# Heading\n\npara B\n\npara A\n');
  });

  it('normalizes separators (no doubled/zero blank lines at the seam)', () => {
    const text = 'A\n\nB\n\nC\n';
    // Move "B" (lines [2,3)) to the end; the A/C seam must stay single-blank.
    const out = moveBlock(text, 2, 3, Number.MAX_SAFE_INTEGER);
    assert.strictEqual(out, 'A\n\nC\n\nB\n');
  });

  it('is a no-op when dropping a block onto itself', () => {
    const text = 'A\n\nB\n';
    assert.strictEqual(moveBlock(text, 0, 1, 0), text);
  });

  it('returns the original text for invalid ranges', () => {
    const text = 'A\n\nB\n';
    assert.strictEqual(moveBlock(text, 5, 9, 0), text);
    assert.strictEqual(moveBlock(text, 2, 2, 0), text);
  });

  it('preserves a file without a trailing newline', () => {
    const text = 'A\n\nB';
    const out = moveBlock(text, 2, 3, 0);
    assert.strictEqual(out, 'B\n\nA');
  });
});

describe('replaceLines', () => {
  it('replaces a single line block', () => {
    const text = '# Title\n\nold paragraph\n\nnext\n';
    const out = replaceLines(text, 2, 3, 'new paragraph');
    assert.strictEqual(out, '# Title\n\nnew paragraph\n\nnext\n');
  });

  it('replaces a multi-line range with multi-line text', () => {
    const text = 'a\nb\nc\n';
    const out = replaceLines(text, 0, 2, 'X\nY\nZ');
    assert.strictEqual(out, 'X\nY\nZ\nc\n');
  });

  it('preserves a file without a trailing newline', () => {
    const text = 'a\n\nb';
    assert.strictEqual(replaceLines(text, 2, 3, 'B'), 'a\n\nB');
  });
});

describe('toggleTaskLine', () => {
  it('checks an unchecked item', () => {
    const text = '- [ ] todo\n';
    assert.strictEqual(toggleTaskLine(text, 0), '- [x] todo\n');
  });

  it('unchecks a checked item (any case)', () => {
    assert.strictEqual(toggleTaskLine('- [x] done\n', 0), '- [ ] done\n');
    assert.strictEqual(toggleTaskLine('- [X] done\n', 0), '- [ ] done\n');
  });

  it('handles indented and ordered task items', () => {
    assert.strictEqual(toggleTaskLine('  - [ ] sub\n', 0), '  - [x] sub\n');
    assert.strictEqual(toggleTaskLine('1. [ ] first\n', 0), '1. [x] first\n');
  });

  it('leaves non-task lines unchanged', () => {
    const text = 'just a paragraph\n';
    assert.strictEqual(toggleTaskLine(text, 0), text);
  });
});
