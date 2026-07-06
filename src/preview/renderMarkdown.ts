import MarkdownIt from 'markdown-it';
// @ts-expect-error -- no bundled types for this small plugin
import taskLists from 'markdown-it-task-lists';
import matter from 'gray-matter';
import calloutPlugin from './transformCallouts';
import codeBlockPlugin, { type HighlightFn } from './transformCodeBlocks';
import mathPlugin from './transformMath';
import { sanitize } from './sanitize';
import { isExternalReference } from './resolveAssets';

export interface RenderOptions {
  /**
   * Resolve a local image reference (already relative to the document) to a
   * WebView-safe URI, or return `null` when the file could not be found.
   */
  resolveImage: (rawSrc: string) => string | null;
  enableMermaid: boolean;
  enableRawHtml: boolean;
  isDark: boolean;
  /** Render `$...$` / `$$...$$` TeX math with KaTeX (default true). */
  enableMath?: boolean;
  /** Show YAML frontmatter as a Notion-style properties block (default false). */
  showFrontmatter?: boolean;
}

/** Languages preloaded into the Shiki highlighter. Unlisted langs fall back to plain text. */
const SHIKI_LANGS = [
  'typescript', 'tsx', 'javascript', 'jsx', 'json', 'jsonc',
  'python', 'ruby', 'go', 'rust', 'java', 'kotlin', 'c', 'cpp', 'csharp',
  'php', 'swift', 'bash', 'shell', 'powershell',
  'yaml', 'toml', 'ini', 'html', 'xml', 'css', 'scss', 'sql',
  'markdown', 'diff', 'graphql', 'docker', 'make', 'vue', 'svelte',
];

const SHIKI_THEMES = ['github-light', 'github-dark'] as const;

/** Minimal surface of the Shiki highlighter we rely on (avoids an ESM type import). */
interface ShikiHighlighter {
  codeToHtml(code: string, options: { lang: string; theme: string }): string;
}

let highlighterPromise: Promise<ShikiHighlighter> | null = null;

/** Lazily create (and cache) the Shiki highlighter. */
async function getHighlighter(): Promise<ShikiHighlighter> {
  if (!highlighterPromise) {
    highlighterPromise = import('shiki').then(({ createHighlighter }) =>
      createHighlighter({ themes: [...SHIKI_THEMES], langs: SHIKI_LANGS }),
    ) as Promise<ShikiHighlighter>;
  }
  return highlighterPromise;
}

function buildHighlightFn(highlighter: ShikiHighlighter, isDark: boolean): HighlightFn {
  const theme = isDark ? 'github-dark' : 'github-light';
  return (code, lang) => {
    try {
      return highlighter.codeToHtml(code, { lang, theme });
    } catch {
      // Unknown / unloaded language → caller renders safe plain text.
      return null;
    }
  };
}

/** Build a URL-safe (but unicode-friendly) slug for heading anchors. */
function slugify(text: string, used: Map<string, number>): string {
  const base =
    text
      .trim()
      .toLowerCase()
      .replace(/[\s]+/g, '-')
      .replace(/[^\p{L}\p{N}\-_]/gu, '')
      .replace(/-{2,}/g, '-')
      .replace(/^-+|-+$/g, '') || 'section';
  const seen = used.get(base) ?? 0;
  used.set(base, seen + 1);
  return seen === 0 ? base : `${base}-${seen}`;
}

/**
 * Annotate block tokens so the client can (a) build a table of contents from
 * heading anchors, (b) sync scrolling to the source editor, and (c) reorder
 * blocks by their source range. Line numbers are made **file-absolute** by
 * adding `lineOffset` (the number of lines consumed by frontmatter), since
 * markdown-it sees only the post-frontmatter content.
 */
function annotatePlugin(lineOffset: number) {
  return (md: MarkdownIt): void => {
    md.core.ruler.push('notion_annotate', (state) => {
      const used = new Map<string, number>();
      const tokens = state.tokens;
      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (token.map && token.nesting >= 0) {
          token.attrSet('data-source-line', String(token.map[0] + lineOffset));
          token.attrSet('data-source-end', String(token.map[1] + lineOffset));
        }
        if (token.type === 'heading_open') {
          const inline = tokens[i + 1];
          const text = inline && inline.type === 'inline' ? inline.content : '';
          token.attrSet('id', slugify(text, used));
        }
      }
      return false;
    });
  };
}

/** Count the number of lines a prefix string occupies. */
function countLines(prefix: string): number {
  if (prefix.length === 0) {
    return 0;
  }
  return prefix.split('\n').length - 1;
}

/** Format one frontmatter value the way Notion shows property values. */
function frontmatterValueHtml(value: unknown, escape: (s: string) => string): string {
  if (Array.isArray(value)) {
    return value
      .map((item) => `<span class="fm-tag">${escape(frontmatterText(item))}</span>`)
      .join('');
  }
  if (typeof value === 'boolean') {
    return `<span class="fm-bool">${value ? '☑' : '☐'} ${value}</span>`;
  }
  return escape(frontmatterText(value));
}

function frontmatterText(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  if (value === null || value === undefined) {
    return '—';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

/**
 * Render YAML frontmatter as a Notion-style properties block. The block carries
 * the frontmatter's source range so scroll sync and block editing treat it like
 * any other block.
 */
function renderFrontmatter(
  data: Record<string, unknown>,
  lineCount: number,
  escape: (s: string) => string,
): string {
  const entries = Object.entries(data);
  if (entries.length === 0) {
    return '';
  }
  const rows = entries
    .map(
      ([key, value]) =>
        `<div class="fm-row"><span class="fm-key">${escape(key)}</span>` +
        `<span class="fm-value">${frontmatterValueHtml(value, escape)}</span></div>`,
    )
    .join('');
  return `<div class="frontmatter" data-source-line="0" data-source-end="${lineCount}">${rows}</div>\n`;
}

function renderMissingImage(reference: string, escape: (s: string) => string): string {
  return (
    '<div class="missing-image" role="img" aria-label="Missing image">' +
    '<span class="missing-image-icon" aria-hidden="true">🖼️</span>' +
    `<span class="missing-image-label">Image not found: ${escape(reference)}</span>` +
    '</div>'
  );
}

function configureImageRule(md: MarkdownIt, options: RenderOptions): void {
  const escapeHtml = md.utils.escapeHtml;
  md.renderer.rules.image = (tokens, idx) => {
    const token = tokens[idx];
    const rawSrc = token.attrGet('src') ?? '';
    const alt = token.content ?? '';
    const title = token.attrGet('title');

    if (isExternalReference(rawSrc)) {
      // External network access is disabled by default (NFR-005). Show a block
      // rather than a broken image that the CSP would block silently.
      return renderMissingImage(`${alt || rawSrc} (external images disabled)`, escapeHtml);
    }

    const uri = options.resolveImage(rawSrc);
    if (!uri) {
      return renderMissingImage(alt || rawSrc, escapeHtml);
    }

    const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
    return (
      '<figure class="image-block">' +
      `<img src="${escapeHtml(uri)}" alt="${escapeHtml(alt)}"${titleAttr} />` +
      (alt ? `<figcaption>${escapeHtml(alt)}</figcaption>` : '') +
      '</figure>'
    );
  };
}

/**
 * Render Markdown text into sanitized, Notion-styled HTML.
 *
 * The function is async only because the Shiki highlighter loads lazily; all
 * per-block rendering is synchronous afterwards. Any single failing block is
 * contained (mermaid errors surface on the client, missing images become a
 * block) so the overall preview never collapses (NFR-201).
 */
export async function renderMarkdown(text: string, options: RenderOptions): Promise<string> {
  const highlighter = await getHighlighter();
  const highlight = buildHighlightFn(highlighter, options.isDark);

  const md = new MarkdownIt({
    html: options.enableRawHtml,
    linkify: true,
    breaks: false,
    typographer: false,
  });

  // Strip YAML frontmatter from the body (FR-108). Track how many lines it
  // consumed so source-line annotations stay file-absolute, and keep the parsed
  // data around for the Notion-style properties block.
  let content = text;
  let frontmatterData: Record<string, unknown> = {};
  try {
    const parsed = matter(text);
    content = parsed.content;
    frontmatterData = parsed.data as Record<string, unknown>;
  } catch {
    content = text;
  }
  const lineOffset = countLines(text.slice(0, Math.max(0, text.length - content.length)));

  md.use(taskLists, { enabled: true, label: true, labelAfter: true });
  md.use(calloutPlugin);
  md.use(codeBlockPlugin, { enableMermaid: options.enableMermaid, highlight, lineOffset });
  if (options.enableMath !== false) {
    md.use(mathPlugin);
  }
  md.use(annotatePlugin(lineOffset));
  configureImageRule(md, options);

  const propertiesHtml = options.showFrontmatter
    ? renderFrontmatter(frontmatterData, lineOffset, md.utils.escapeHtml)
    : '';
  const rendered = md.render(content);
  return sanitize(propertiesHtml + rendered);
}
