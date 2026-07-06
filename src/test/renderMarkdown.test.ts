import * as assert from 'assert';
import { renderMarkdown } from '../preview/renderMarkdown';

const baseOptions = {
  enableMermaid: true,
  enableRawHtml: false,
  isDark: false,
  resolveImage: (src: string) => (src.includes('found') ? `https://webview/${src}` : null),
};

describe('renderMarkdown', () => {
  it('renders basic markdown to HTML', async () => {
    const out = await renderMarkdown('# Title\n\nHello **bold** and `code`.', baseOptions);
    assert.match(out, /<h1[^>]*>Title<\/h1>/);
    assert.ok(out.includes('<strong>bold</strong>'));
    assert.ok(out.includes('<code>code</code>'));
  });

  it('adds slug ids to headings for the outline', async () => {
    const out = await renderMarkdown('# Hello World\n\n## Section', baseOptions);
    assert.ok(out.includes('id="hello-world"'));
    assert.ok(out.includes('id="section"'));
  });

  it('annotates blocks with source line numbers for scroll sync', async () => {
    const out = await renderMarkdown('# Title\n\nparagraph', baseOptions);
    assert.ok(out.includes('data-source-line='));
    assert.ok(out.includes('data-source-end='));
  });

  it('uses file-absolute source lines when frontmatter is present', async () => {
    // Frontmatter occupies lines 0-3; the heading is on file line 4.
    const out = await renderMarkdown('---\ntitle: x\n---\n\n# Heading', baseOptions);
    assert.match(out, /<h1[^>]*data-source-line="4"/);
  });

  it('strips YAML frontmatter from the body', async () => {
    const out = await renderMarkdown('---\ntitle: x\n---\n\n# Body', baseOptions);
    assert.match(out, /<h1[^>]*>Body<\/h1>/);
    assert.ok(!out.includes('title: x'));
  });

  it('renders frontmatter as a properties block when enabled', async () => {
    const src = '---\ntitle: Spec\ntags:\n  - api\n  - payment\ndone: true\n---\n\n# Body';
    const out = await renderMarkdown(src, { ...baseOptions, showFrontmatter: true });
    assert.ok(out.includes('class="frontmatter"'));
    assert.ok(out.includes('Spec'));
    assert.match(out, /class="fm-tag"[^>]*>api</);
    assert.ok(out.includes('☑'));
    // The block carries the frontmatter's source range for editing/scroll sync.
    assert.match(out, /class="frontmatter" data-source-line="0" data-source-end="\d+"/);
  });

  it('hides frontmatter properties by default', async () => {
    const out = await renderMarkdown('---\ntitle: x\n---\n\n# Body', baseOptions);
    assert.ok(!out.includes('class="frontmatter"'));
  });

  it('renders inline and block math with KaTeX', async () => {
    const out = await renderMarkdown('Euler: $e^{i\\pi} = -1$\n\n$$\n\\frac{a}{b}\n$$', baseOptions);
    assert.ok(out.includes('class="math-inline"'));
    assert.ok(out.includes('class="math-block"'));
    assert.ok(out.includes('katex'));
  });

  it('leaves dollar amounts in prose alone', async () => {
    const out = await renderMarkdown('It costs $5 and $10 in total.', baseOptions);
    assert.ok(!out.includes('math-inline'));
    assert.ok(out.includes('$5 and $10'));
  });

  it('can disable math rendering', async () => {
    const out = await renderMarkdown('$x^2$', { ...baseOptions, enableMath: false });
    assert.ok(!out.includes('math-inline'));
  });

  it('shows the raw source instead of crashing on invalid TeX', async () => {
    const out = await renderMarkdown('$\\notarealmacro{x}$', baseOptions);
    assert.ok(out.includes('math-error'));
  });

  it('does not execute or emit raw script tags by default', async () => {
    const out = await renderMarkdown("<script>alert('xss')</script>\n\nafter", baseOptions);
    assert.ok(!out.includes('<script'));
    assert.ok(out.includes('after'));
  });

  it('wraps code blocks in a Notion-style card with a copy button', async () => {
    const out = await renderMarkdown('```ts\nconst a = 1;\n```', baseOptions);
    assert.ok(out.includes('class="code-block"'));
    assert.ok(out.includes('class="code-lang"'));
    assert.ok(out.includes('class="copy-btn"'));
    assert.ok(out.includes('TypeScript'));
  });

  it('falls back to plain text for unknown languages', async () => {
    const out = await renderMarkdown('```nope\nraw text\n```', baseOptions);
    assert.ok(out.includes('code-plain'));
    assert.ok(out.includes('raw text'));
  });

  it('emits a mermaid placeholder for mermaid blocks', async () => {
    const out = await renderMarkdown('```mermaid\ngraph TD\nA-->B\n```', baseOptions);
    assert.ok(out.includes('class="mermaid"'));
    assert.ok(out.includes('data-mermaid-src'));
  });

  it('renders a missing-image block when the asset cannot be resolved', async () => {
    const out = await renderMarkdown('![alt](missing.png)', baseOptions);
    assert.ok(out.includes('missing-image'));
  });

  it('rewrites resolvable images to the provided URI', async () => {
    const out = await renderMarkdown('![alt](found.png)', baseOptions);
    assert.ok(out.includes('<img'));
    assert.ok(out.includes('https://webview/found.png'));
  });
});
