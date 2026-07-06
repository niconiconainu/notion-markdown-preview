# Security Policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems.
Report privately via [GitHub Security Advisories](https://github.com/niconiconainu/notion-markdown-preview/security/advisories/new)
("Report a vulnerability"). You should receive a response within 72 hours.

Supported versions: only the latest release receives security fixes.

## Threat model & design decisions

This extension renders local Markdown files. The primary threats are
(1) malicious Markdown documents attacking the reader, and
(2) compromised dependencies attacking everyone.

### Rendering untrusted Markdown

- **No network access from the preview.** Mermaid, KaTeX (CSS + fonts), Shiki
  and all scripts are bundled into the extension. The WebView CSP has
  `default-src 'none'` — no fetch/XHR/WebSocket, external images are blocked
  and shown as a placeholder block.
- **Strict CSP**: scripts require a per-render nonce; `base-uri 'none'`,
  `form-action 'none'`.
- **Allowlist sanitizer** (`sanitize-html`) runs over ALL rendered output —
  even our own — as defense-in-depth: no script tags, no event handlers, no
  `javascript:` URLs, inline styles restricted to Shiki colors and KaTeX
  layout lengths. Raw HTML in Markdown is **off by default**
  (`notionPreview.enableRawHtml`).
- **Link hardening**: external links may only use `http:`, `https:` or
  `mailto:` — `command:`, `vscode:` and other scheme URIs in documents are
  blocked. Local links are confined to the workspace / document folder
  (no `../../` traversal out of the project).
- **WebView file access** is limited via `localResourceRoots` to the
  extension's `media/`, the document's folder and the workspace.
- **Mermaid** runs with `securityLevel: 'strict'`.
- All messages from the WebView to the extension are type-checked and
  size-capped before use.

### Supply chain

- `.npmrc` sets **`ignore-scripts=true`** — dependency lifecycle scripts never
  execute, locally or in CI (the dominant npm malware vector).
- **`scripts/check-lockfile.js`** (run in CI before install) verifies every
  lockfile entry resolves to `registry.npmjs.org` with a `sha512` integrity
  hash — a poisoned-lockfile PR fails the build.
- CI uses `npm ci` (exact lockfile), runs `npm audit` as a gate, and all
  GitHub Actions are **pinned to full commit SHAs** with a read-only
  `GITHUB_TOKEN`.
- Dependabot opens grouped weekly update PRs; updates are reviewed by a
  human, never auto-merged.
- The published `.vsix` contains only compiled bundles and assets
  (`vsce ls` runs in CI so the file list is reviewable).

## Release checklist (maintainers)

1. Bump `package.json` and add a `## [x.y.z]` section to `CHANGELOG.md`
   (the release workflow fails without both).
2. `npm run check:lockfile && npm audit && npm run lint && npm test`
3. Merge to `main` — the **Release workflow** detects the untagged version,
   rebuilds from a clean checkout, re-runs the supply-chain gates and tests,
   then creates the `vX.Y.Z` tag and a GitHub Release with the `.vsix`
   attached and the matching CHANGELOG section as notes. No manual tagging.
4. Marketplace publishing stays manual and off-CI: publish from a machine
   with 2FA enabled on GitHub **and** the VS Code Marketplace publisher
   account; the marketplace PAT is scoped to *Marketplace → Manage* only and
   stored in a password manager (never in the repo or CI).
