import type MarkdownIt from 'markdown-it';

/**
 * A synchronous syntax highlighter. Returns ready-to-embed `<pre class="shiki">`
 * HTML, or `null` when the language is unsupported or highlighting failed — in
 * which case the caller falls back to safe escaped plain text (FR-305).
 */
export type HighlightFn = (code: string, lang: string) => string | null;

export interface CodeBlockOptions {
  enableMermaid: boolean;
  highlight: HighlightFn;
  /** Lines consumed by frontmatter, to keep source ranges file-absolute. */
  lineOffset?: number;
}

/** Friendly display names for the language label shown in the card header. */
const LANG_LABELS: Record<string, string> = {
  ts: 'TypeScript',
  tsx: 'TSX',
  typescript: 'TypeScript',
  js: 'JavaScript',
  jsx: 'JSX',
  javascript: 'JavaScript',
  py: 'Python',
  python: 'Python',
  rb: 'Ruby',
  go: 'Go',
  rs: 'Rust',
  rust: 'Rust',
  java: 'Java',
  kt: 'Kotlin',
  c: 'C',
  cpp: 'C++',
  cs: 'C#',
  php: 'PHP',
  swift: 'Swift',
  sh: 'Shell',
  bash: 'Shell',
  zsh: 'Shell',
  shell: 'Shell',
  json: 'JSON',
  yaml: 'YAML',
  yml: 'YAML',
  toml: 'TOML',
  html: 'HTML',
  css: 'CSS',
  scss: 'SCSS',
  sql: 'SQL',
  md: 'Markdown',
  markdown: 'Markdown',
  diff: 'Diff',
  graphql: 'GraphQL',
  dockerfile: 'Dockerfile',
};

function languageLabel(lang: string): string {
  if (!lang) {
    return 'Plain Text';
  }
  return LANG_LABELS[lang.toLowerCase()] ?? lang;
}

export default function codeBlockPlugin(md: MarkdownIt, options: CodeBlockOptions): void {
  const escapeHtml = md.utils.escapeHtml;

  md.renderer.rules.fence = (tokens, idx) => {
    const token = tokens[idx];
    const info = token.info.trim();
    const lang = info.split(/\s+/)[0] ?? '';
    const code = token.content;
    const offset = options.lineOffset ?? 0;
    const lineAttr = token.map
      ? ` data-source-line="${token.map[0] + offset}" data-source-end="${token.map[1] + offset}"`
      : '';

    // --- Mermaid diagram placeholder (rendered on the client) ---
    if (options.enableMermaid && lang.toLowerCase() === 'mermaid') {
      return (
        `<div class="mermaid-block"${lineAttr}>` +
        '<div class="block-label">Diagram</div>' +
        `<pre class="mermaid" data-mermaid-src="${escapeHtml(code)}">${escapeHtml(code)}</pre>` +
        '</div>'
      );
    }

    // --- Highlighted (or plain) code card ---
    const highlighted = lang ? options.highlight(code, lang) : null;
    const body = highlighted
      ? highlighted
      : `<pre class="code-plain"><code>${escapeHtml(code)}</code></pre>`;

    return (
      `<div class="code-block"${lineAttr}>` +
      '<div class="code-block-header">' +
      `<span class="code-lang">${escapeHtml(languageLabel(lang))}</span>` +
      `<button class="copy-btn" type="button" aria-label="Copy code" data-code="${escapeHtml(code)}">Copy</button>` +
      '</div>' +
      `<div class="code-block-body">${body}</div>` +
      '</div>'
    );
  };
}
