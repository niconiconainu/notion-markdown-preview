import type MarkdownIt from 'markdown-it';
import katex from 'katex';

// Derive the parser-state types from the ruler signatures (the .mjs type files
// they live in cannot be type-imported from this CommonJS build).
type RuleInline = Parameters<MarkdownIt['inline']['ruler']['after']>[2];
type StateInline = Parameters<RuleInline>[0];
type RuleBlock = Parameters<MarkdownIt['block']['ruler']['after']>[2];
type StateBlock = Parameters<RuleBlock>[0];

/**
 * markdown-it plugin that renders `$...$` (inline) and `$$...$$` (block) TeX
 * math with KaTeX, entirely server-side — no client JS and no CDN (NFR-005).
 * The delimiter rules follow the de-facto markdown-it-katex conventions so
 * dollar amounts in prose ("$5 and $10") are not mistaken for math.
 */

/** Render TeX to KaTeX HTML; on syntax errors fall back to highlighted source. */
function renderTex(tex: string, displayMode: boolean, escape: (s: string) => string): string {
  try {
    return katex.renderToString(tex, {
      displayMode,
      output: 'html', // HTML-only output (no MathML) keeps the sanitizer surface small
      throwOnError: true,
    });
  } catch {
    return `<code class="math-error" title="KaTeX could not parse this expression">${escape(tex)}</code>`;
  }
}

/** Whether the `$` at `pos` can OPEN inline math (not followed by whitespace/digit-adjacent). */
function canOpen(src: string, pos: number): boolean {
  const next = src[pos + 1];
  return next !== undefined && !/\s/.test(next) && next !== '$';
}

/** Whether the `$` at `pos` can CLOSE inline math (not preceded by whitespace, not followed by a digit). */
function canClose(src: string, pos: number): boolean {
  const prev = src[pos - 1];
  const next = src[pos + 1];
  if (prev === undefined || /\s/.test(prev) || prev === '$') {
    return false;
  }
  return next === undefined || !/\d/.test(next);
}

function mathInline(state: StateInline, silent: boolean): boolean {
  const { src, pos } = state;
  if (src[pos] !== '$' || !canOpen(src, pos)) {
    return false;
  }

  let end = pos + 1;
  while ((end = src.indexOf('$', end)) !== -1) {
    // A `\$` inside the expression does not terminate it.
    let backslashes = 0;
    for (let k = end - 1; k >= 0 && src[k] === '\\'; k--) {
      backslashes += 1;
    }
    if (backslashes % 2 === 0 && canClose(src, end)) {
      break;
    }
    end += 1;
  }
  if (end === -1 || end >= state.posMax) {
    return false;
  }
  const content = src.slice(pos + 1, end);
  if (content.trim().length === 0) {
    return false;
  }

  if (!silent) {
    const token = state.push('math_inline', 'math', 0);
    token.markup = '$';
    token.content = content;
  }
  state.pos = end + 1;
  return true;
}

function mathBlock(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  const start = state.bMarks[startLine] + state.tShift[startLine];
  const max = state.eMarks[startLine];
  if (start + 2 > max || state.src.slice(start, start + 2) !== '$$') {
    return false;
  }
  if (silent) {
    return true;
  }

  let firstLine = state.src.slice(start + 2, max);
  let lastLine = '';
  let found = false;
  let next = startLine;

  // Single-line form: `$$ ... $$`
  if (firstLine.trim().endsWith('$$')) {
    firstLine = firstLine.trim().slice(0, -2);
    found = true;
  }

  while (!found) {
    next += 1;
    if (next >= endLine) {
      break;
    }
    const lineStart = state.bMarks[next] + state.tShift[next];
    const lineMax = state.eMarks[next];
    const line = state.src.slice(lineStart, lineMax);
    if (line.trim().endsWith('$$')) {
      lastLine = line.trim().slice(0, -2);
      found = true;
    }
  }
  if (!found) {
    return false;
  }

  const token = state.push('math_block', 'math', 0);
  token.block = true;
  token.content =
    (firstLine.trim() ? `${firstLine.trim()}\n` : '') +
    state.getLines(startLine + 1, next, state.tShift[startLine], true) +
    (lastLine.trim() ? lastLine.trim() : '');
  token.map = [startLine, next + 1];
  token.markup = '$$';
  state.line = next + 1;
  return true;
}

export default function mathPlugin(md: MarkdownIt): void {
  const escape = md.utils.escapeHtml;
  md.inline.ruler.after('escape', 'math_inline', mathInline);
  md.block.ruler.after('blockquote', 'math_block', mathBlock, {
    alt: ['paragraph', 'reference', 'blockquote', 'list'],
  });
  md.renderer.rules.math_inline = (tokens, idx) =>
    `<span class="math-inline">${renderTex(tokens[idx].content, false, escape)}</span>`;
  md.renderer.rules.math_block = (tokens, idx) => {
    // The annotate plugin stamps file-absolute source lines (frontmatter offset
    // included) onto the token — reuse them so scroll sync and block editing work.
    const line = tokens[idx].attrGet('data-source-line');
    const end = tokens[idx].attrGet('data-source-end');
    const lineAttrs =
      line !== null && end !== null ? ` data-source-line="${line}" data-source-end="${end}"` : '';
    return `<div class="math-block"${lineAttrs}>${renderTex(tokens[idx].content, true, escape)}</div>\n`;
  };
}
