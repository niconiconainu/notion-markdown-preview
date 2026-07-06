# Changelog

All notable changes to the **Notion-like Markdown Preview** extension are
documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [0.11.0] - 2026-07-03

### Added

- **Git change highlights**: the **diff** toolbar button marks blocks added or
  edited since the last commit with a green gutter-style bar, and inserts a
  collapsible red **"N deleted lines"** chip where content was removed —
  click it to see the deleted text (GitHub diff style). Off by default (the
  usual clean preview); the toggle is remembered per panel and needs no
  re-render. Hidden automatically for files outside a git repository or not
  yet tracked.

## [0.10.2] - 2026-07-03

### Changed

- Modernized the runtime baseline: requires VS Code **1.96+** (Node 20+
  extension host). Development toolchain now targets Node 22+ locally and
  Node 24 (current LTS) in CI; the WebView bundle targets ES2022.

## [0.10.1] - 2026-07-03

### Security

- **Link hardening**: external links in documents may only use
  `http:` / `https:` / `mailto:` — `command:`, `vscode:` and other scheme URIs
  are blocked. Local links are confined to the workspace / document folder
  (no `../..` traversal to arbitrary files).
- **Stricter CSP**: added `base-uri 'none'` and `form-action 'none'` to the
  preview WebView.
- **Supply chain**: dependency lifecycle scripts disabled via `.npmrc`
  (`ignore-scripts=true`); new `scripts/check-lockfile.js` verifies every
  lockfile entry resolves to registry.npmjs.org with sha512 integrity; CI
  workflow with read-only token and SHA-pinned actions; Dependabot config;
  `SECURITY.md` with threat model and private reporting channel.
- **Dependencies**: resolved all `npm audit` findings (serialize-javascript
  override, esbuild ≥0.28); 0 known vulnerabilities.
- SVG save channel from the WebView is size-capped (20 MB).

## [0.10.0] - 2026-07-02

### Added

- **Find in preview**: `Cmd/Ctrl+F` (or the 🔍 toolbar button) opens a find bar
  with live highlighting, a match counter, and Enter / Shift+Enter navigation.
  Matches inside collapsed sections are expanded automatically when jumped to.
- **Two-way scroll sync**: scrolling the preview now scrolls the source editor
  to the matching line (editor → preview sync already existed).
- **Frontmatter properties**: YAML frontmatter is rendered as a Notion-style
  properties block at the top of the page (tags become chips, booleans become
  checkboxes). Disable with `notionPreview.showFrontmatter: false`.
- **TeX math**: `$...$` and `$$...$$` are rendered with KaTeX, bundled locally
  (no CDN). Invalid expressions degrade to highlighted source. Disable with
  `notionPreview.enableMath: false`.
- **Markdown links open in preview**: links to other `.md` files open as a
  preview panel in the same group (with `#anchor` support), so linked specs can
  be browsed Notion-style. Disable with
  `notionPreview.openLinksInPreview: false` to restore opening in the editor.

## [0.9.4] - 2026-07-02

### Added

- **Light/dark theme toggle**: a ◐ button in the preview toolbar and a new
  **Notion Preview: Toggle Light/Dark Theme** command flip the preview theme in
  one click. The choice is saved to `notionPreview.theme`, so all open previews
  switch together.
- **Multiple previews**: each Markdown file now gets its own preview panel.
  Previews stay pinned to their file instead of retargeting to the active
  editor, so several documents can be previewed side by side. Re-running the
  command on a file whose preview is open just reveals it.

### Fixed

- **Light preview inside a dark editor no longer shows dark artifacts.** VS
  Code injects a default stylesheet into every WebView whose colors follow the
  *editor* theme, not the preview theme. Those defaults are now neutralized:
  - code blocks no longer paint a dark chip behind each line
    (`code { background: var(--vscode-textPreformat-background) }`),
  - blockquotes no longer get a dark background
    (`blockquote { background: var(--vscode-textBlockQuote-background) }`),
  - scrollbar tracks inside the preview stay neutral.
- Blockquote bar is derived from the text color instead of
  `--vscode-widget-border`, so it follows light/dark themes correctly.
- Inline code no longer uses the dark-mode color when the preview is pinned to
  light while VS Code itself is dark.

## [0.9.3] - 2026-06-29

### Changed

- The block drag grip is now a **single floating handle that follows the hovered
  block** (Notion-style), instead of one handle injected into each block. This
  makes **every** block type draggable — including code blocks, tables and
  mermaid diagrams, whose `overflow: hidden` previously clipped the handle (and
  avoids putting an invalid child inside `<table>`).

## [0.9.2] - 2026-06-28

### Changed

- In-place editing now works for **any top-level block** (code blocks, tables,
  callouts, blockquotes, mermaid, images), not just paragraphs/headings/list
  items. Clicking a block opens its raw Markdown for safe editing.
- **Undo/redo from the preview no longer steals focus.** `Ctrl/Cmd+Z` (and
  redo) are applied via the extension's own per-document history as a
  `WorkspaceEdit`, so the view stays on the Notion preview instead of jumping to
  the text editor.

## [0.9.1] - 2026-06-28

### Fixed

- In-place edits (inline block editing and checkbox toggling) now refresh the
  preview immediately. Programmatic `WorkspaceEdit`s change the in-memory
  document without "saving", so in the default `onSave` update mode the preview
  previously didn't reflect the change — making it look like editing did
  nothing. The manager now re-renders right after applying its own edits.

## [0.9.0] - 2026-06-28

### Added (in-place editing)

- **Checkbox toggling**: click a task-list checkbox to flip `[ ]` ↔ `[x]` in the
  source.
- **In-place block editing**: click a paragraph / heading / list item to edit
  its raw Markdown inline; Esc cancels, Cmd/Ctrl+Enter or clicking away commits.
  Edits are written to the block's source range (no HTML→Markdown conversion, so
  nothing is lost) as a single minimal-diff, undoable `WorkspaceEdit`.
- **Format toolbar** while editing: Bold / Italic / Inline-code / Link wrap the
  current selection with the right Markdown.
- The raw document source is embedded in the WebView so block ranges can be
  edited without a round-trip.

### Notes

- Full rendered "type-on-the-page" WYSIWYG for every block type is intentionally
  not attempted from scratch (it risks corrupting real `.md` files). Editing
  operates on Markdown source ranges, which is safe and lossless. A
  library-based true-WYSIWYG layer could be added later as an opt-in.

## [0.8.1] - 2026-06-28

### Changed

- Block drag-and-drop is now **always available** (no edit-mode toggle): the
  drag grip appears on hover over any block, so reading stays clean. The ✏
  toolbar button was removed.

### Fixed

- Block-move edits are now applied as a **minimal diff** (common prefix/suffix)
  instead of a whole-file replace, so `Ctrl/Cmd+Z` undoes a move as one clean
  step.
- `Ctrl/Cmd+Z` (and `Ctrl+Y` / `Cmd+Shift+Z`) pressed **in the preview** are
  forwarded to the source document's undo/redo.

## [0.8.0] - 2026-06-28

### Added (opt-in block editing)

- **Edit mode** (toolbar ✏): toggles Notion-style drag handles on each
  top-level block. Read-only is still the default.
- **Drag & drop to reorder blocks** — dropping a block rewrites the underlying
  `.md` by moving its source line range (Markdown stays the source of truth; no
  HTML→Markdown conversion). The edit is applied as a single undoable
  `WorkspaceEdit` and is **not** auto-saved (save with Cmd/Ctrl+S).
- Source-line annotations are now **file-absolute** (frontmatter offset
  applied), which also makes scroll sync exact. Each block carries
  `data-source-line` and `data-source-end`.
- Scroll position is preserved across the write-back re-render.

## [0.7.0] - 2026-06-28

### Changed (Mermaid UI)

- Diagrams now use a **theme-matched palette and font** (mermaid `base` theme
  with Notion/VS Code colors) instead of the stock blue/green, and follow
  light/dark.
- Each diagram has a **hover toolbar**: zoom in/out, fit, source toggle, save as
  SVG, and fullscreen — replacing the hard-to-discover click-to-zoom.
- **In-place pan & zoom** (wheel + drag) inside a bounded viewport, so large
  diagrams stay contained and explorable without opening the modal.
- **Source view** toggles between the diagram and its mermaid code; **Save as
  SVG** writes the diagram to disk via a native save dialog.
- Lightbox background now follows the theme so themed diagrams stay readable.

## [0.6.0] - 2026-06-28

### Added (easier launching)

- **Keyboard shortcut**: `Cmd+K N` / `Ctrl+K N` while a Markdown file is focused.
- **Status bar button**: a `$(book) Notion Preview` item shown for Markdown
  files — one click to open.
- **Context menus**: "Open Notion Preview" in the editor right-click menu and on
  `.md` files in the Explorer.

## [0.5.0] - 2026-06-28

### Added (readability / lower cognitive load)

- **Orientation**: a reading-progress bar, a scroll-aware floating "back to top"
  button, and the current section name shown in the toolbar.
- **Block recognition**: callouts now show a type label (NOTE/WARNING/…),
  external links get an ↗ icon (internal links a dotted underline), headings
  reveal a `#` anchor on hover, and images are click-to-zoom (same lightbox as
  mermaid).
- **Collapsible sections**: fold/unfold sections under h1–h3 headings, plus
  collapse-all / expand-all in the toolbar.
- **Calmer toolbar**: icon buttons with tooltips, auto-hide on scroll down /
  reveal on scroll up, and a reading-time + character-count readout.

## [0.4.0] - 2026-06-28

### Added

- **Mermaid zoom**: click a rendered diagram to open a lightbox with
  scroll-to-zoom, drag-to-pan, zoom buttons, and Esc to close.

### Fixed

- The **page-width toggle** now works (the width is applied inline so it wins
  over the initial value).
- The **outline toggle** now works at any pane width — the outline is a flex
  sidebar instead of a wide-screen-only floating panel.

### Changed

- Visual polish: tinted callouts, rounded tables, refined scrollbars, heading
  letter-spacing, selection color.

## [0.3.0] - 2026-06-28

### Added

- **Outline (TOC) sidebar** built from heading anchors, with active-section
  highlighting as you scroll and click-to-jump.
- **Usable links**: external URLs open in the system browser; relative links
  (including `.md`) open in the editor — and a following preview retargets to
  opened Markdown automatically.
- **Scroll sync**: scrolling the source editor scrolls the preview to the
  matching block (via per-block `data-source-line` anchors).
- **Toolbar** with font size −/A/+, page-width toggle, outline toggle, and
  back-to-top. Preferences persist per preview via WebView state.

### Changed

- Typography and spacing polish; headings now have stable slug ids.

## [0.2.0] - 2026-06-28

### Added

- The preview now follows the active editor: switching to another Markdown file
  retargets the existing preview to it (no need to re-run the command). When the
  new file is outside the panel's allowed resource roots, the panel is recreated
  so its images still resolve.

## [0.1.0] - 2026-06-28

### Added

- `Open Notion Preview` command, editor title button, and Command Palette entry.
- WebView preview panel opened beside the active Markdown document.
- Notion-like rendering: headings, paragraphs, lists, blockquotes, tables, links.
- Code blocks with language label, copy button, and Shiki syntax highlighting;
  unknown languages fall back to safe plain text.
- Mermaid diagrams rendered from a locally bundled build, with per-block error
  containment.
- Callout blocks (`[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]`).
- Task list checkboxes.
- Notion-export image resolution: URL-encoded paths, same-name and `.assets`
  folders, Japanese file names, and a "missing image" block when unresolved.
- Light/dark theme that follows VS Code, with manual override.
- Save-time and optional debounced auto-refresh.
- Security: strict CSP with nonce, HTML sanitization, raw HTML disabled by
  default, no external network access, restricted `localResourceRoots`.
- Configuration: `theme`, `pageWidth`, `enableMermaid`, `enableRawHtml`,
  `updateMode`.
- Unit tests for the markdown renderer, asset resolver, callout transform,
  sanitizer, and nonce generator.
