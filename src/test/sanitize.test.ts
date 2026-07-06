import * as assert from 'assert';
import { sanitize } from '../preview/sanitize';

describe('sanitize', () => {
  it('removes script tags', () => {
    const out = sanitize('<p>ok</p><script>alert(1)</script>');
    assert.ok(!out.includes('<script'));
    assert.ok(out.includes('<p>ok</p>'));
  });

  it('strips inline event handlers', () => {
    const out = sanitize('<img src="x.png" onerror="alert(1)" />');
    assert.ok(!out.includes('onerror'));
  });

  it('drops javascript: URLs from links', () => {
    const out = sanitize('<a href="javascript:alert(1)">x</a>');
    assert.ok(!out.toLowerCase().includes('javascript:'));
  });

  it('keeps allowed structural markup and classes', () => {
    const html =
      '<div class="callout callout-note"><div class="callout-content"><p>hi</p></div></div>';
    const out = sanitize(html);
    assert.ok(out.includes('class="callout callout-note"'));
    assert.ok(out.includes('<p>hi</p>'));
  });

  it('preserves Shiki-style inline color', () => {
    const out = sanitize('<span style="color:#79b8ff">x</span>');
    assert.ok(out.includes('color:#79b8ff') || out.includes('color: #79b8ff'));
  });
});
