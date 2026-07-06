import sanitizeHtml from 'sanitize-html';

/**
 * Allowlist-based sanitizer for the HTML produced by the Markdown renderer.
 *
 * Even though `markdown-it` runs with `html: false` by default, the rendered
 * output still contains HTML that we generate ourselves (callouts, code-block
 * cards, mermaid placeholders, Shiki spans). This pass is defense-in-depth: it
 * guarantees no `<script>`, event handler, or dangerous URL survives, which is
 * essential once `enableRawHtml` is turned on (NFR-004 / FR-804).
 */

const ALLOWED_TAGS = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'a', 'ul', 'ol', 'li',
  'blockquote', 'hr', 'br',
  'em', 'strong', 'del', 's', 'sub', 'sup', 'mark',
  'code', 'pre', 'span', 'div',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'img', 'input', 'button', 'figure', 'figcaption',
  'details', 'summary',
  // KaTeX draws sqrt radicals and stretchy delimiters with inline SVG.
  'svg', 'path', 'g', 'line',
];

const SHARED_ATTRS = ['class', 'id', 'style', 'title', 'aria-hidden', 'data-source-line', 'data-source-end'];

/** CSS length values KaTeX emits for layout (e.g. `height:1.08em`, `top:-3.1em`). */
const CSS_LENGTH = /^-?\d*\.?\d+(em|ex|px|pt|rem|%)?$/;

const baseOptions: sanitizeHtml.IOptions = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: {
    '*': SHARED_ATTRS,
    a: [...SHARED_ATTRS, 'href', 'name', 'target', 'rel'],
    img: [...SHARED_ATTRS, 'src', 'alt', 'width', 'height'],
    input: [...SHARED_ATTRS, 'type', 'checked', 'disabled'],
    button: [...SHARED_ATTRS, 'type', 'aria-label', 'data-code'],
    th: [...SHARED_ATTRS, 'align', 'colspan', 'rowspan', 'scope'],
    td: [...SHARED_ATTRS, 'align', 'colspan', 'rowspan'],
    pre: [...SHARED_ATTRS, 'data-lang', 'data-mermaid-src', 'tabindex'],
    code: [...SHARED_ATTRS, 'data-lang'],
    div: [...SHARED_ATTRS],
    svg: [...SHARED_ATTRS, 'xmlns', 'width', 'height', 'viewBox', 'preserveAspectRatio'],
    path: [...SHARED_ATTRS, 'd'],
    line: [...SHARED_ATTRS, 'x1', 'y1', 'x2', 'y2', 'stroke-width'],
  },
  // Image sources may be vscode webview resource URIs (https) or inline data URIs.
  allowedSchemes: ['http', 'https', 'mailto', 'vscode-resource', 'vscode-webview-resource'],
  allowedSchemesByTag: {
    img: ['http', 'https', 'data', 'vscode-resource', 'vscode-webview-resource'],
  },
  // Preserve inline styles emitted by Shiki (token colors) and KaTeX (layout
  // lengths) without allowing arbitrary CSS that could leak data or break the
  // page layout.
  allowedStyles: {
    '*': {
      color: [/^#(0x)?[0-9a-f]+$/i, /^rgb\(/, /^rgba\(/, /^var\(--/],
      'background-color': [/^#(0x)?[0-9a-f]+$/i, /^rgb\(/, /^rgba\(/, /^var\(--/],
      'font-weight': [/^\d+$/, /^bold$/, /^normal$/],
      'font-style': [/^italic$/, /^normal$/],
      'text-decoration': [/^underline$/, /^line-through$/, /^none$/],
      height: [CSS_LENGTH],
      width: [CSS_LENGTH],
      'min-width': [CSS_LENGTH],
      top: [CSS_LENGTH],
      bottom: [CSS_LENGTH],
      left: [CSS_LENGTH],
      right: [CSS_LENGTH],
      'vertical-align': [CSS_LENGTH],
      'margin-left': [CSS_LENGTH],
      'margin-right': [CSS_LENGTH],
      'margin-top': [CSS_LENGTH],
      'margin-bottom': [CSS_LENGTH],
      'padding-left': [CSS_LENGTH],
      'padding-right': [CSS_LENGTH],
      'padding-top': [CSS_LENGTH],
      'padding-bottom': [CSS_LENGTH],
      'border-bottom-width': [CSS_LENGTH],
    },
  },
  transformTags: {
    // Harden links: external navigation is blocked by CSP anyway, but make
    // intent explicit and strip any window-opener relationship.
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }),
  },
};

export function sanitize(html: string): string {
  return sanitizeHtml(html, baseOptions);
}
