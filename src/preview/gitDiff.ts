/**
 * Parse `git diff --unified=0` output into line ranges for the preview's
 * change highlights (VS Code gutter-style). Pure module — no `vscode` or
 * `child_process` dependency — so it can be unit tested (NFR-401).
 */

export interface DeletedChunk {
  /** 0-based line in the CURRENT file the removed content sits directly above. */
  line: number;
  /** The removed lines, joined with `\n` (shown when the marker is expanded). */
  text: string;
  /**
   * True for a pure deletion; false when the lines were replaced by new
   * content (a "modified" hunk — git coalesces delete+insert at the same spot,
   * so this is how most section deletions actually surface).
   */
  pure: boolean;
}

export interface GitChangeRanges {
  /** 0-based inclusive [start, end] line ranges added since HEAD. */
  added: Array<[number, number]>;
  /** 0-based inclusive [start, end] line ranges modified since HEAD. */
  modified: Array<[number, number]>;
  /** Pure deletions, with their removed content. */
  deleted: DeletedChunk[];
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export function parseUnifiedDiff(diffOutput: string): GitChangeRanges {
  const result: GitChangeRanges = { added: [], modified: [], deleted: [] };
  const lines = diffOutput.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const match = HUNK_HEADER.exec(lines[i]);
    if (!match) {
      continue;
    }
    const oldCount = match[2] !== undefined ? Number(match[2]) : 1;
    const newStart = Number(match[3]);
    const newCount = match[4] !== undefined ? Number(match[4]) : 1;

    // With --unified=0 the hunk body is exactly `oldCount` "-" lines followed
    // by `newCount` "+" lines. Collect the removed content.
    const removed: string[] = [];
    for (let j = i + 1; j < lines.length && removed.length < oldCount; j++) {
      if (HUNK_HEADER.test(lines[j])) {
        break;
      }
      if (lines[j].startsWith('-')) {
        removed.push(lines[j].slice(1));
      }
    }

    if (newCount === 0) {
      // Pure deletion: `+c,0` means content was removed after line c (1-based),
      // i.e. directly above the 0-based current-file line c.
      result.deleted.push({ line: Math.max(0, newStart), text: removed.join('\n'), pure: true });
      continue;
    }
    const range: [number, number] = [newStart - 1, newStart - 1 + newCount - 1];
    if (oldCount === 0) {
      result.added.push(range);
    } else {
      result.modified.push(range);
      // Keep the replaced (old) content so it can be inspected in the preview.
      result.deleted.push({ line: newStart - 1, text: removed.join('\n'), pure: false });
    }
  }
  return result;
}

/** True when a block spanning [start, end) intersects any of the ranges. */
export function intersectsRanges(
  start: number,
  end: number,
  ranges: Array<[number, number]>,
): boolean {
  return ranges.some(([rs, re]) => rs < end && re >= start);
}
