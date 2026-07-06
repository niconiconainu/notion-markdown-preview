import * as fs from 'fs';
import * as path from 'path';

/**
 * Resolve a Markdown image reference to an absolute path on disk.
 *
 * Notion exports are inconsistent: image references may be URL-encoded
 * (`Project%20Plan/image.png`), may live in a sibling folder named after the
 * page, or in a `<page>.assets/` folder. This resolver tries a prioritized set
 * of candidate locations (requirements §13.2) and returns the first one that
 * exists, or `null` so the caller can render a "missing image" block.
 *
 * It is intentionally free of any `vscode` dependency so it can be unit tested
 * against fixture directories.
 */
export interface ResolveAssetOptions {
  /** Directory of the Markdown file the reference came from. */
  baseDir: string;
  /** Markdown file name without extension, e.g. "Project Plan". */
  pageName?: string;
}

/** Returns true for references that point outside the local file system. */
export function isExternalReference(src: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(src) && !src.toLowerCase().startsWith('file:');
}

function existsAsFile(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/** Build the ordered list of candidate absolute paths to probe. */
function candidatePaths(src: string, options: ResolveAssetOptions): string[] {
  const { baseDir, pageName } = options;
  const candidates: string[] = [];
  const add = (p: string) => {
    const resolved = path.resolve(baseDir, p);
    if (!candidates.includes(resolved)) {
      candidates.push(resolved);
    }
  };

  // 1. The reference as written (handles already-decoded relative paths).
  add(src);

  // 2. URL-decoded form (handles %20 spaces, encoded parens, Japanese names).
  let decoded = src;
  try {
    decoded = decodeURIComponent(src);
    add(decoded);
  } catch {
    // Malformed escape sequence — keep the raw form only.
  }

  const fileName = path.basename(decoded);

  // 3. Same-name directory next to the Markdown file (Notion's default layout).
  if (pageName) {
    add(path.join(pageName, fileName));
    // 4. The `<page>.assets/` directory variant.
    add(`${pageName}.assets/${fileName}`);
  }

  // 5. A bare `assets/` directory fallback.
  add(path.join('assets', fileName));

  return candidates;
}

/**
 * @returns the absolute path of the first existing candidate, or `null`.
 */
export function resolveAssets(src: string, options: ResolveAssetOptions): string | null {
  if (!src || isExternalReference(src)) {
    return null;
  }
  for (const candidate of candidatePaths(src, options)) {
    if (existsAsFile(candidate)) {
      return candidate;
    }
  }
  return null;
}
