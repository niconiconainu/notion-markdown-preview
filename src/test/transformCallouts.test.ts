import * as assert from 'assert';
import MarkdownIt from 'markdown-it';
import calloutPlugin from '../preview/transformCallouts';

function render(markdown: string): string {
  const md = new MarkdownIt({ html: false });
  md.use(calloutPlugin);
  return md.render(markdown);
}

describe('transformCallouts', () => {
  it('converts [!NOTE] blockquotes into callout blocks', () => {
    const out = render('> [!NOTE]\n> これはメモです。');
    assert.ok(out.includes('class="callout callout-note"'));
    assert.ok(out.includes('callout-icon'));
    assert.ok(out.includes('callout-content'));
    assert.ok(out.includes('これはメモです。'));
    // The raw marker text must be stripped.
    assert.ok(!out.includes('[!NOTE]'));
  });

  it('supports all documented kinds', () => {
    for (const kind of ['TIP', 'IMPORTANT', 'WARNING', 'CAUTION']) {
      const out = render(`> [!${kind}]\n> body`);
      assert.ok(out.includes(`callout-${kind.toLowerCase()}`), `missing ${kind}`);
    }
  });

  it('leaves ordinary blockquotes untouched', () => {
    const out = render('> just a normal quote');
    assert.ok(out.includes('<blockquote>'));
    assert.ok(!out.includes('callout'));
  });

  it('ignores unknown alert types', () => {
    const out = render('> [!UNKNOWN]\n> body');
    assert.ok(out.includes('<blockquote>'));
    assert.ok(!out.includes('callout'));
  });
});
