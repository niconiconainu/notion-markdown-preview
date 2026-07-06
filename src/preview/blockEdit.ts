/**
 * Pure, `vscode`-free helpers for block-level Markdown editing.
 *
 * The preview never converts HTML back into Markdown. Instead, each rendered
 * top-level block carries its source line range (`data-source-line` /
 * `data-source-end`, file-absolute). Reordering a block is therefore a pure
 * line-range move on the original Markdown text — the Markdown stays the source
 * of truth, so nothing is lost.
 */

function isBlank(line: string): boolean {
  return line.trim() === '';
}

function clampIndex(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.floor(value)));
}

/**
 * Replace source lines `[start, end)` with `replacement` (which may contain
 * newlines). The original Markdown is edited in place — no HTML→Markdown
 * conversion — so nothing is lost. A trailing newline is preserved.
 */
export function replaceLines(
  text: string,
  start: number,
  end: number,
  replacement: string,
): string {
  const hadTrailingNewline = text.endsWith('\n');
  const body = hadTrailingNewline ? text.slice(0, -1) : text;
  const lines = body.split('\n');
  const s = clampIndex(start, 0, lines.length);
  const e = clampIndex(end, s, lines.length);
  const repl = replacement.split('\n');
  const out = [...lines.slice(0, s), ...repl, ...lines.slice(e)];
  let result = out.join('\n');
  if (hadTrailingNewline) {
    result += '\n';
  }
  return result;
}

const TASK_RE = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/;

/** Flip a task-list checkbox (`[ ]` ↔ `[x]`) on the given source line. */
export function toggleTaskLine(text: string, line: number): string {
  const hadTrailingNewline = text.endsWith('\n');
  const body = hadTrailingNewline ? text.slice(0, -1) : text;
  const lines = body.split('\n');
  if (line < 0 || line >= lines.length) {
    return text;
  }
  const match = lines[line].match(TASK_RE);
  if (!match) {
    return text;
  }
  const next = match[2] === ' ' ? 'x' : ' ';
  const prefixLen = match[1].length;
  lines[line] = lines[line].slice(0, prefixLen) + next + lines[line].slice(prefixLen + 1);
  let result = lines.join('\n');
  if (hadTrailingNewline) {
    result += '\n';
  }
  return result;
}

/**
 * Move the block occupying source lines `[fromStart, fromEnd)` so that it is
 * inserted before the line currently at `toStart`. All indices are 0-based and
 * file-absolute; `fromEnd` and `toStart` are exclusive/insertion positions.
 *
 * Blank-line separators are normalized to a single blank line at both the
 * removal seam and the insertion point, so blocks never collide or accumulate
 * extra blank lines. A trailing newline (if present) is preserved. Invalid or
 * no-op moves return the original text unchanged.
 */
export function moveBlock(
  text: string,
  fromStart: number,
  fromEnd: number,
  toStart: number,
): string {
  const hadTrailingNewline = text.endsWith('\n');
  const body = hadTrailingNewline ? text.slice(0, -1) : text;
  const lines = body.split('\n');
  const n = lines.length;

  const start = Math.max(0, Math.floor(fromStart));
  const end = Math.min(n, Math.floor(fromEnd));
  if (end <= start || start >= n) {
    return text;
  }
  // Dropping onto itself.
  if (toStart === start) {
    return text;
  }
  if (toStart > start && toStart < end) {
    return text;
  }

  // The block to move, with any trailing blank lines trimmed off.
  const block = lines.slice(start, end);
  while (block.length && isBlank(block[block.length - 1])) {
    block.pop();
  }
  if (block.length === 0) {
    return text;
  }

  const remainder = [...lines.slice(0, start), ...lines.slice(end)];

  // Map the (original-coordinate) target into remainder coordinates.
  let insertAt = toStart <= start ? toStart : toStart - (end - start);
  insertAt = Math.max(0, Math.min(remainder.length, Math.floor(insertAt)));

  // Collapse a doubled blank line left behind at the removal seam.
  const seam = start;
  if (seam > 0 && seam < remainder.length && isBlank(remainder[seam - 1]) && isBlank(remainder[seam])) {
    remainder.splice(seam, 1);
    if (insertAt > seam) {
      insertAt -= 1;
    }
  }

  const before = remainder.slice(0, insertAt);
  const after = remainder.slice(insertAt);
  while (before.length && isBlank(before[before.length - 1])) {
    before.pop();
  }
  while (after.length && isBlank(after[0])) {
    after.shift();
  }

  const parts: string[] = [...before];
  if (before.length) {
    parts.push('');
  }
  parts.push(...block);
  if (after.length) {
    parts.push('');
    parts.push(...after);
  }

  // Trim blank lines that ended up at the very start/end of the file (e.g. a
  // separator left dangling when a block was moved off a boundary).
  while (parts.length && isBlank(parts[parts.length - 1])) {
    parts.pop();
  }
  while (parts.length && isBlank(parts[0])) {
    parts.shift();
  }

  let out = parts.join('\n');
  if (hadTrailingNewline) {
    out += '\n';
  }
  return out;
}
