import type { GitChangeRanges } from './gitDiff';

/**
 * Build the full WebView HTML document. This module is kept free of any direct
 * `vscode` dependency — the caller passes in already-resolved WebView URIs and
 * the CSP source string (NFR-401).
 */
export interface WebviewHtmlOptions {
  /** Sanitized body HTML produced by renderMarkdown. */
  bodyHtml: string;
  /** Per-render nonce used to authorize inline/script tags. */
  nonce: string;
  /** `webview.cspSource` value for the CSP `img/style/font` directives. */
  cspSource: string;
  /** WebView URI of media/preview.css. */
  styleUri: string;
  /** WebView URI of media/preview.js. */
  scriptUri: string;
  /** WebView URI of the bundled KaTeX stylesheet (omitted when math is disabled). */
  katexCssUri?: string;
  /** Heading anchor to scroll to on first render (set when opened via a `#fragment` link). */
  initialAnchor?: string;
  /** Working-tree changes vs HEAD, or null when not in git / untracked. */
  gitChanges?: GitChangeRanges | null;
  /** User theme preference. */
  theme: 'auto' | 'light' | 'dark';
  /** Maximum content width in pixels. */
  pageWidth: number;
  /** Whether mermaid rendering is enabled. */
  enableMermaid: boolean;
  /** Whether the active VS Code theme is dark (for mermaid + 'auto' fallback). */
  isDark: boolean;
  /** Document title for the tab/heading. */
  title: string;
  /** Raw Markdown source, so the client can edit block source ranges in place. */
  source: string;
}

/** Embed a string in a script tag safely (prevents `</script>` breakout). */
function embedJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function themeClass(theme: WebviewHtmlOptions['theme']): string {
  if (theme === 'light') {
    return 'force-light';
  }
  if (theme === 'dark') {
    return 'force-dark';
  }
  return '';
}

export function createWebviewHtml(options: WebviewHtmlOptions): string {
  const { nonce, cspSource } = options;

  const csp = [
    "default-src 'none'",
    `img-src ${cspSource} data:`,
    `style-src ${cspSource} 'unsafe-inline'`,
    `font-src ${cspSource} data:`,
    `script-src 'nonce-${nonce}'`,
    // No <base> retargeting and no form submission channel out of the webview.
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');

  const config = {
    enableMermaid: options.enableMermaid,
    isDark: options.isDark,
    theme: options.theme,
    pageWidth: Number(options.pageWidth),
    initialAnchor: options.initialAnchor ?? null,
    gitChanges: options.gitChanges ?? null,
  };

  const katexLink = options.katexCssUri
    ? `\n  <link href="${escapeHtml(options.katexCssUri)}" rel="stylesheet" />`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${escapeHtml(options.styleUri)}" rel="stylesheet" />${katexLink}
  <title>${escapeHtml(options.title)}</title>
</head>
<body class="notion-preview ${themeClass(options.theme)}" style="--notion-page-width: ${Number(options.pageWidth)}px;">
  <div class="reading-progress" aria-hidden="true"><div class="reading-progress-fill" id="progress-fill"></div></div>
  <header class="toolbar" id="toolbar" role="toolbar" aria-label="Preview controls">
    <button class="tb-btn icon" type="button" data-action="toggle-toc" aria-label="Toggle outline" title="Toggle outline">☰</button>
    <span class="current-section" id="current-section" aria-live="polite"></span>
    <div class="toolbar-spacer"></div>
    <span class="doc-meta" id="doc-meta"></span>
    <div class="tb-group" role="group" aria-label="Collapse sections">
      <button class="tb-btn icon" type="button" data-action="collapse-all" aria-label="Collapse all sections" title="Collapse all sections">⊟</button>
      <button class="tb-btn icon" type="button" data-action="expand-all" aria-label="Expand all sections" title="Expand all sections">⊞</button>
    </div>
    <div class="tb-group" role="group" aria-label="Font size">
      <button class="tb-btn" type="button" data-action="font-dec" aria-label="Decrease font size" title="Smaller text">A−</button>
      <button class="tb-btn" type="button" data-action="font-reset" aria-label="Reset font size" title="Reset text size">A</button>
      <button class="tb-btn" type="button" data-action="font-inc" aria-label="Increase font size" title="Larger text">A+</button>
    </div>
    <button class="tb-btn" type="button" data-action="toggle-git" aria-label="Toggle git change highlights" aria-pressed="false" title="Highlight changes since last commit (git diff)">diff</button>
    <button class="tb-btn icon" type="button" data-action="toggle-find" aria-label="Find in preview" title="Find in preview (Cmd/Ctrl+F)">🔍</button>
    <button class="tb-btn icon" type="button" data-action="toggle-width" aria-label="Toggle page width" title="Toggle wide / narrow">⟷</button>
    <button class="tb-btn icon" type="button" data-action="toggle-theme" aria-label="Toggle light / dark theme" title="Toggle light / dark theme">◐</button>
  </header>
  <div class="find-bar" id="find-bar" role="search" hidden>
    <input class="find-input" id="find-input" type="text" placeholder="Find…" aria-label="Find in preview" spellcheck="false" />
    <span class="find-count" id="find-count" aria-live="polite"></span>
    <button class="tb-btn icon" type="button" data-find="prev" aria-label="Previous match" title="Previous match (Shift+Enter)">↑</button>
    <button class="tb-btn icon" type="button" data-find="next" aria-label="Next match" title="Next match (Enter)">↓</button>
    <button class="tb-btn icon" type="button" data-find="close" aria-label="Close find" title="Close (Esc)">✕</button>
  </div>
  <div class="layout">
    <nav class="toc" id="toc" aria-label="Table of contents"></nav>
    <main class="notion-page" id="notion-page">
      ${options.bodyHtml}
    </main>
  </div>
  <button class="fab-top" id="fab-top" type="button" aria-label="Back to top" title="Back to top">↑</button>
  <script nonce="${nonce}">window.__notionPreviewConfig = ${JSON.stringify(config)};
window.__notionSource = ${embedJson(options.source)};</script>
  <script nonce="${nonce}" src="${escapeHtml(options.scriptUri)}"></script>
</body>
</html>`;
}

/** Minimal document shown when the underlying file no longer exists (FR-603). */
export function createMissingFileHtml(options: Pick<WebviewHtmlOptions, 'nonce' | 'cspSource' | 'styleUri' | 'theme' | 'pageWidth' | 'title'>): string {
  const csp = [
    "default-src 'none'",
    `style-src ${options.cspSource} 'unsafe-inline'`,
    `font-src ${options.cspSource} data:`,
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <link href="${escapeHtml(options.styleUri)}" rel="stylesheet" />
  <title>${escapeHtml(options.title)}</title>
</head>
<body class="notion-preview ${themeClass(options.theme)}" style="--notion-page-width: ${Number(options.pageWidth)}px;">
  <main class="notion-page">
    <div class="file-missing">
      <div class="file-missing-icon" aria-hidden="true">📄</div>
      <h1>File not available</h1>
      <p>The Markdown file for this preview no longer exists or could not be read.</p>
    </div>
  </main>
</body>
</html>`;
}
