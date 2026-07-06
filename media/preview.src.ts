/*
 * WebView client script. Bundled (with mermaid) by esbuild into preview.js so
 * nothing is loaded from a CDN (FR-404 / FR-405). Responsibilities:
 *   - render mermaid diagrams per-block, containing any syntax error (FR-403)
 *   - mermaid + image zoom lightbox
 *   - code-block copy buttons (FR-303)
 *   - outline (TOC) with active-section highlight + current-section label
 *   - reading progress bar, scroll-aware "back to top", reading-time meta
 *   - collapsible sections (fold under headings)
 *   - usable links (external → browser, local → editor) with affordance icons
 *   - auto-hiding toolbar + scroll sync from the source editor
 */
import mermaid from 'mermaid';

interface GitChangeRanges {
  added: Array<[number, number]>;
  modified: Array<[number, number]>;
  deleted: Array<{ line: number; text: string; pure: boolean }>;
}

interface PreviewConfig {
  enableMermaid: boolean;
  isDark: boolean;
  theme: 'auto' | 'light' | 'dark';
  pageWidth: number;
  initialAnchor: string | null;
  gitChanges: GitChangeRanges | null;
}

interface PreviewState {
  fontScale: number;
  wide: boolean;
  tocHidden: boolean;
  scrollY: number;
  gitHighlight: boolean;
}

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): PreviewState | undefined;
  setState(state: PreviewState): void;
};

declare global {
  interface Window {
    __notionPreviewConfig?: PreviewConfig;
    __notionSource?: string;
  }
}

const vscode = acquireVsCodeApi();

const config: PreviewConfig = window.__notionPreviewConfig ?? {
  enableMermaid: true,
  isDark: false,
  theme: 'auto',
  pageWidth: 800,
  initialAnchor: null,
  gitChanges: null,
};

const state: PreviewState = {
  fontScale: 1,
  wide: false,
  tocHidden: false,
  scrollY: 0,
  gitHighlight: false,
  ...(vscode.getState() ?? {}),
};

function saveState(): void {
  vscode.setState(state);
}

function applyState(): void {
  document.documentElement.style.setProperty('--notion-font-scale', String(state.fontScale));
  const width = state.wide ? Math.max(config.pageWidth, 1100) : config.pageWidth;
  document.body.style.setProperty('--notion-page-width', `${width}px`);
  document.body.classList.toggle('wide', state.wide);
  document.body.classList.toggle('toc-hidden', state.tocHidden);
  document.body.classList.toggle('show-git-changes', state.gitHighlight);
  const gitBtn = document.querySelector<HTMLButtonElement>('button[data-action="toggle-git"]');
  if (gitBtn) {
    gitBtn.classList.toggle('pressed', state.gitHighlight);
    gitBtn.setAttribute('aria-pressed', String(state.gitHighlight));
  }
}

function isDarkMode(): boolean {
  if (config.theme === 'dark') {
    return true;
  }
  if (config.theme === 'light') {
    return false;
  }
  return (
    document.body.classList.contains('vscode-dark') ||
    document.body.classList.contains('vscode-high-contrast') ||
    config.isDark
  );
}

function escapeHtml(value: string): string {
  const div = document.createElement('div');
  div.textContent = value;
  return div.innerHTML;
}

function page(): HTMLElement | null {
  return document.getElementById('notion-page');
}

/* ------------------------------ Document meta ----------------------------- */

function updateDocMeta(): void {
  const meta = document.getElementById('doc-meta');
  const main = page();
  if (!meta || !main) {
    return;
  }
  const text = main.innerText || '';
  const chars = text.replace(/\s+/g, '').length;
  if (chars === 0) {
    return;
  }
  const minutes = Math.max(1, Math.round(chars / 500));
  meta.textContent = `${minutes} min read · ${chars.toLocaleString()} chars`;
}

/* ------------------------------ Table of contents ------------------------------ */

let headingEls: HTMLElement[] = [];

function buildToc(): void {
  const toc = document.getElementById('toc');
  const main = page();
  if (!toc || !main) {
    return;
  }
  headingEls = Array.from(main.querySelectorAll<HTMLElement>('h1[id], h2[id], h3[id], h4[id]'));
  if (headingEls.length < 2) {
    document.body.classList.add('no-toc');
    return;
  }

  const list = document.createElement('ul');
  list.className = 'toc-list';
  for (const heading of headingEls) {
    const level = Number(heading.tagName.substring(1));
    const item = document.createElement('li');
    item.className = `toc-item toc-level-${level}`;
    const link = document.createElement('a');
    link.href = `#${heading.id}`;
    link.textContent = heading.textContent ?? '';
    link.dataset.target = heading.id;
    item.appendChild(link);
    list.appendChild(item);
  }
  toc.innerHTML = '';
  toc.appendChild(list);

  toc.addEventListener('click', (event) => {
    const target = (event.target as HTMLElement).closest('a');
    if (!target) {
      return;
    }
    event.preventDefault();
    const id = target.dataset.target;
    const el = id ? document.getElementById(id) : null;
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });

  observeHeadings(toc);
}

function observeHeadings(toc: HTMLElement): void {
  const links = new Map<string, HTMLElement>();
  toc.querySelectorAll<HTMLElement>('a[data-target]').forEach((a) => {
    links.set(a.dataset.target ?? '', a);
  });
  const currentSection = document.getElementById('current-section');

  let activeId = '';
  const setActive = (id: string) => {
    if (id === activeId) {
      return;
    }
    activeId = id;
    links.forEach((a) => a.classList.remove('active'));
    const link = links.get(id);
    if (link) {
      link.classList.add('active');
      link.scrollIntoView({ block: 'nearest' });
    }
    const heading = headingEls.find((h) => h.id === id);
    if (currentSection && heading) {
      currentSection.textContent = heading.dataset.title ?? heading.textContent ?? '';
    }
  };

  const visible = new Set<string>();
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).id;
        if (entry.isIntersecting) {
          visible.add(id);
        } else {
          visible.delete(id);
        }
      }
      for (const heading of headingEls) {
        if (visible.has(heading.id)) {
          setActive(heading.id);
          break;
        }
      }
    },
    { rootMargin: '0px 0px -70% 0px', threshold: 0 },
  );
  headingEls.forEach((h) => observer.observe(h));
}

/* ------------------------- Heading anchors + collapsing ------------------------- */

function isHeading(el: Element | null): el is HTMLElement {
  return !!el && /^H[1-6]$/.test(el.tagName);
}
function headingLevel(el: Element): number {
  return Number(el.tagName.substring(1));
}
function isCollapsible(el: Element): boolean {
  return /^H[123]$/.test(el.tagName);
}

/** Elements belonging to a heading's section (until the next same/higher heading). */
function sectionSiblings(heading: HTMLElement): HTMLElement[] {
  const lvl = headingLevel(heading);
  const out: HTMLElement[] = [];
  let el = heading.nextElementSibling as HTMLElement | null;
  while (el) {
    if (isHeading(el) && headingLevel(el) <= lvl) {
      break;
    }
    out.push(el);
    el = el.nextElementSibling as HTMLElement | null;
  }
  return out;
}

function setCollapsed(heading: HTMLElement, collapsed: boolean): void {
  heading.classList.toggle('collapsed', collapsed);
  const sibs = sectionSiblings(heading);
  sibs.forEach((el) => el.classList.remove('section-hidden'));
  if (collapsed) {
    sibs.forEach((el) => el.classList.add('section-hidden'));
  } else {
    // Keep nested already-collapsed sections folded.
    for (const el of sibs) {
      if (isHeading(el) && el.classList.contains('collapsed')) {
        sectionSiblings(el).forEach((c) => c.classList.add('section-hidden'));
      }
    }
  }
}

function initHeadings(): void {
  const main = page();
  if (!main) {
    return;
  }
  main.querySelectorAll<HTMLElement>('h1[id], h2[id], h3[id], h4[id]').forEach((heading) => {
    // Preserve clean text for the current-section label before we add controls.
    heading.dataset.title = heading.textContent ?? '';

    // Hover anchor link.
    const anchor = document.createElement('a');
    anchor.className = 'heading-anchor';
    anchor.href = `#${heading.id}`;
    anchor.setAttribute('aria-label', 'Link to this section');
    anchor.textContent = '#';
    heading.appendChild(anchor);

    // Collapse toggle for h1–h3.
    if (isCollapsible(heading)) {
      heading.classList.add('collapsible');
      const toggle = document.createElement('button');
      toggle.className = 'collapse-toggle';
      toggle.type = 'button';
      toggle.setAttribute('aria-label', 'Collapse section');
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        setCollapsed(heading, !heading.classList.contains('collapsed'));
      });
      heading.insertBefore(toggle, heading.firstChild);
    }
  });
}

function collapseAll(collapsed: boolean): void {
  const main = page();
  if (!main) {
    return;
  }
  Array.from(main.children).forEach((el) => {
    if (isCollapsible(el)) {
      el.classList.toggle('collapsed', collapsed);
      el.classList.remove('section-hidden');
    } else if (collapsed) {
      el.classList.add('section-hidden');
    } else {
      el.classList.remove('section-hidden');
    }
  });
}

/* --------------------- Edit mode: block drag & drop ----------------------- */

let draggedBlock: HTMLElement | null = null;
let dropIndicator: HTMLElement | null = null;
let blockHandle: HTMLElement | null = null;
let hoveredBlock: HTMLElement | null = null;

function blocksOf(main: HTMLElement): HTMLElement[] {
  return Array.from(main.children).filter((c) =>
    (c as HTMLElement).hasAttribute('data-source-line'),
  ) as HTMLElement[];
}

/** The top-level block (direct child of #notion-page) containing `target`. */
function topLevelBlock(main: HTMLElement, target: HTMLElement | null): HTMLElement | null {
  let el: HTMLElement | null = target;
  while (el && el.parentElement && el.parentElement !== main) {
    el = el.parentElement;
  }
  return el && el.parentElement === main && el.hasAttribute('data-source-line') ? el : null;
}

function ensureIndicator(): HTMLElement {
  if (!dropIndicator) {
    dropIndicator = document.createElement('div');
    dropIndicator.className = 'drop-indicator';
  }
  return dropIndicator;
}

/** The block before which a drop at vertical position `y` would land (null = end). */
function dropReference(main: HTMLElement, y: number): HTMLElement | null {
  for (const block of blocksOf(main)) {
    if (block === draggedBlock) {
      continue;
    }
    const r = block.getBoundingClientRect();
    if (y < r.top + r.height / 2) {
      return block;
    }
  }
  return null;
}

function cleanupDnd(): void {
  if (draggedBlock) {
    draggedBlock.classList.remove('dragging');
  }
  draggedBlock = null;
  if (dropIndicator && dropIndicator.parentElement) {
    dropIndicator.remove();
  }
  if (blockHandle) {
    blockHandle.classList.remove('show');
  }
}

function performMove(main: HTMLElement, dragged: HTMLElement, ref: HTMLElement | null): void {
  // Capture source coordinates from the *current* render before moving the DOM.
  const fromStart = Number(dragged.dataset.sourceLine);
  const fromEnd = Number(dragged.dataset.sourceEnd);
  const toStart = ref ? Number(ref.dataset.sourceLine) : Number.MAX_SAFE_INTEGER;

  // Optimistic reorder for instant feedback; the write-back re-render reconciles.
  if (ref) {
    main.insertBefore(dragged, ref);
  } else {
    main.appendChild(dragged);
  }
  cleanupDnd();

  if (Number.isFinite(fromStart) && Number.isFinite(fromEnd)) {
    vscode.postMessage({ type: 'moveBlock', fromStart, fromEnd, toStart });
  }
}

function wireDnd(main: HTMLElement): void {
  main.addEventListener('dragover', (e) => {
    if (!draggedBlock) {
      return;
    }
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'move';
    }
    const ref = dropReference(main, e.clientY);
    const indicator = ensureIndicator();
    if (ref) {
      main.insertBefore(indicator, ref);
    } else {
      main.appendChild(indicator);
    }
  });

  main.addEventListener('drop', (e) => {
    if (!draggedBlock) {
      return;
    }
    e.preventDefault();
    performMove(main, draggedBlock, dropReference(main, e.clientY));
  });

  main.addEventListener('dragend', cleanupDnd);
}

/**
 * A single floating drag grip (Notion-style) that follows the hovered block.
 * This works uniformly for every block type — including code blocks, tables and
 * mermaid — whose `overflow: hidden` would clip a per-block handle.
 */
function setupBlockDragging(): void {
  const main = page();
  if (!main) {
    return;
  }
  const handle = document.createElement('div');
  handle.className = 'block-handle';
  handle.title = 'Drag to move block';
  handle.setAttribute('aria-label', 'Drag to move block');
  handle.draggable = true;
  handle.textContent = '⠿';
  main.appendChild(handle);
  blockHandle = handle;

  main.addEventListener('mousemove', (e) => {
    if (draggedBlock) {
      return;
    }
    if (activeEditor || e.target === handle) {
      return;
    }
    const block = topLevelBlock(main, e.target as HTMLElement);
    if (block) {
      hoveredBlock = block;
      handle.style.top = `${block.offsetTop + 2}px`;
      handle.style.left = `${Math.max(2, block.offsetLeft - 26)}px`;
      handle.classList.add('show');
    } else {
      handle.classList.remove('show');
    }
  });
  main.addEventListener('mouseleave', () => {
    if (!draggedBlock) {
      handle.classList.remove('show');
    }
  });

  handle.addEventListener('dragstart', (e) => {
    if (!hoveredBlock) {
      e.preventDefault();
      return;
    }
    draggedBlock = hoveredBlock;
    draggedBlock.classList.add('dragging');
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', draggedBlock.dataset.sourceLine ?? '');
    }
  });
  handle.addEventListener('dragend', cleanupDnd);

  wireDnd(main);
}

/** Forward Ctrl/Cmd+Z (and Shift for redo) to the source document's undo stack. */
function initUndoForwarding(): void {
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      vscode.postMessage({ type: e.shiftKey ? 'redo' : 'undo' });
    } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
      e.preventDefault();
      vscode.postMessage({ type: 'redo' });
    }
  });
}

/* ----------------------- Checkboxes (toggle in source) -------------------- */

function initCheckboxes(): void {
  const main = page();
  if (!main) {
    return;
  }
  main.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((cb) => {
    cb.removeAttribute('disabled');
    cb.style.cursor = 'pointer';
    cb.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault(); // let the source-driven re-render set the state
      const item = cb.closest('[data-source-line]') as HTMLElement | null;
      if (!item) {
        return;
      }
      const line = Number(item.dataset.sourceLine);
      if (Number.isFinite(line)) {
        vscode.postMessage({ type: 'toggleCheckbox', line });
      }
    });
  });
}

/* ------------------ Inline editing (per-block raw Markdown) ---------------- */

interface ActiveEditor {
  textarea: HTMLTextAreaElement;
  toolbar: HTMLElement;
  block: HTMLElement;
  start: number;
  end: number;
  original: string;
}

let activeEditor: ActiveEditor | null = null;

function autosize(ta: HTMLTextAreaElement): void {
  ta.style.height = 'auto';
  ta.style.height = `${ta.scrollHeight}px`;
}

function wrapSelection(ta: HTMLTextAreaElement, before: string, after: string): void {
  const s = ta.selectionStart;
  const e = ta.selectionEnd;
  const selected = ta.value.slice(s, e);
  ta.value = ta.value.slice(0, s) + before + selected + after + ta.value.slice(e);
  ta.focus();
  ta.setSelectionRange(s + before.length, s + before.length + selected.length);
  autosize(ta);
}

const FORMAT_ACTIONS: Record<string, [string, string]> = {
  bold: ['**', '**'],
  italic: ['_', '_'],
  code: ['`', '`'],
  link: ['[', '](url)'],
};

function createFormatToolbar(ta: HTMLTextAreaElement): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'format-toolbar';
  bar.innerHTML =
    '<button data-f="bold" title="Bold (**)" aria-label="Bold"><b>B</b></button>' +
    '<button data-f="italic" title="Italic (_)" aria-label="Italic"><i>I</i></button>' +
    '<button data-f="code" title="Inline code (`)" aria-label="Code">&lt;/&gt;</button>' +
    '<button data-f="link" title="Link" aria-label="Link">🔗</button>';
  // Keep focus in the textarea when clicking a toolbar button.
  bar.addEventListener('mousedown', (e) => e.preventDefault());
  bar.addEventListener('click', (e) => {
    const action = (e.target as HTMLElement).closest('button')?.getAttribute('data-f');
    const marks = action ? FORMAT_ACTIONS[action] : undefined;
    if (marks) {
      wrapSelection(ta, marks[0], marks[1]);
    }
  });
  return bar;
}

function commitEdit(): void {
  if (!activeEditor) {
    return;
  }
  const { textarea, toolbar, block, start, end, original } = activeEditor;
  const value = textarea.value;
  activeEditor = null;
  toolbar.remove();
  textarea.remove();
  block.style.display = '';
  if (value !== original) {
    vscode.postMessage({ type: 'replaceRange', start, end, text: value });
  }
}

function cancelEdit(): void {
  if (!activeEditor) {
    return;
  }
  const { textarea, toolbar, block } = activeEditor;
  activeEditor = null;
  toolbar.remove();
  textarea.remove();
  block.style.display = '';
}

function enterEdit(block: HTMLElement, start: number, end: number): void {
  if (activeEditor) {
    commitEdit();
  }
  const lines = (window.__notionSource ?? '').split('\n');
  let e = Math.min(end, lines.length);
  while (e > start && (lines[e - 1] ?? '').trim() === '') {
    e -= 1;
  }
  const md = lines.slice(start, e).join('\n');

  const textarea = document.createElement('textarea');
  textarea.className = 'block-editor';
  textarea.value = md;
  textarea.spellcheck = false;

  const toolbar = createFormatToolbar(textarea);
  const parent = block.parentElement;
  if (!parent) {
    return;
  }
  parent.insertBefore(toolbar, block);
  parent.insertBefore(textarea, block);
  block.style.display = 'none';

  activeEditor = { textarea, toolbar, block, start, end: e, original: md };

  autosize(textarea);
  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);

  textarea.addEventListener('input', () => autosize(textarea));
  textarea.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      cancelEdit();
    } else if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter') {
      ev.preventDefault();
      commitEdit();
    }
  });
  textarea.addEventListener('blur', () => {
    window.setTimeout(() => {
      if (activeEditor && activeEditor.textarea === textarea && document.activeElement !== textarea) {
        commitEdit();
      }
    }, 120);
  });
}

function initInlineEditing(): void {
  const main = page();
  if (!main) {
    return;
  }
  main.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (
      target.closest('a') ||
      target.closest('button') ||
      target.closest('input') ||
      target.closest('.block-handle') ||
      target.closest('.block-editor') ||
      target.closest('.format-toolbar')
    ) {
      return;
    }
    // Don't hijack a text selection (let users select/copy normally).
    if ((window.getSelection()?.toString() ?? '').length > 0) {
      return;
    }
    // Edit a list item at item granularity; everything else at the top-level
    // block (paragraph, heading, code block, table, callout, mermaid, quote …).
    const block =
      (target.closest('li[data-source-line]') as HTMLElement | null) ??
      topLevelBlock(main, target);
    if (!block) {
      return;
    }
    const start = Number(block.dataset.sourceLine);
    const end = Number(block.dataset.sourceEnd);
    if (Number.isFinite(start) && Number.isFinite(end)) {
      enterEdit(block, start, end);
    }
  });
}

/* --------------------------------- Links ---------------------------------- */

function isExternal(href: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(href) && !href.toLowerCase().startsWith('file:');
}

function initLinks(): void {
  const main = page();
  if (!main) {
    return;
  }
  // Affordance icons: external ↗, internal document link.
  main.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((a) => {
    if (a.classList.contains('heading-anchor')) {
      return;
    }
    const href = a.getAttribute('href') ?? '';
    if (href.startsWith('#')) {
      return;
    }
    a.classList.add(isExternal(href) ? 'external-link' : 'doc-link');
  });

  main.addEventListener('click', (event) => {
    const anchor = (event.target as HTMLElement).closest('a');
    if (!anchor) {
      return;
    }
    const href = anchor.getAttribute('href') ?? '';
    if (!href) {
      return;
    }
    if (href.startsWith('#')) {
      event.preventDefault();
      const el = resolveAnchor(href.slice(1));
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      return;
    }
    event.preventDefault();
    vscode.postMessage({ type: 'openLink', href, external: isExternal(href) });
  });
}

/* -------------------------------- Toolbar --------------------------------- */

function initToolbar(): void {
  const toolbar = document.getElementById('toolbar');
  if (!toolbar) {
    return;
  }
  toolbar.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest('button[data-action]');
    if (!button) {
      return;
    }
    switch (button.getAttribute('data-action')) {
      case 'font-inc':
        state.fontScale = Math.min(1.6, Math.round((state.fontScale + 0.1) * 10) / 10);
        break;
      case 'font-dec':
        state.fontScale = Math.max(0.8, Math.round((state.fontScale - 0.1) * 10) / 10);
        break;
      case 'font-reset':
        state.fontScale = 1;
        break;
      case 'toggle-width':
        state.wide = !state.wide;
        break;
      case 'toggle-toc':
        state.tocHidden = !state.tocHidden;
        break;
      case 'collapse-all':
        collapseAll(true);
        return;
      case 'expand-all':
        collapseAll(false);
        return;
      case 'toggle-theme':
        // The extension flips the notionPreview.theme setting and re-renders.
        vscode.postMessage({ type: 'toggleTheme' });
        return;
      case 'toggle-find':
        toggleFindBar();
        return;
      case 'toggle-git':
        state.gitHighlight = !state.gitHighlight;
        break;
      default:
        return;
    }
    applyState();
    saveState();
  });
}

/* --------------------- Reading progress, top button, hide --------------------- */

function initScrollChrome(): void {
  const fill = document.getElementById('progress-fill');
  const fab = document.getElementById('fab-top');
  const toolbar = document.getElementById('toolbar');
  let lastY = window.scrollY;

  if (fab) {
    fab.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  }

  let lastSaved = 0;
  const onScroll = () => {
    const y = window.scrollY;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    if (fill) {
      fill.style.width = max > 0 ? `${(y / max) * 100}%` : '0%';
    }
    if (fab) {
      fab.classList.toggle('visible', y > 400);
    }
    if (toolbar) {
      // Hide on scroll down, reveal on scroll up.
      if (y > lastY + 6 && y > 140) {
        document.body.classList.add('toolbar-hidden');
      } else if (y < lastY - 6) {
        document.body.classList.remove('toolbar-hidden');
      }
    }
    lastY = y;
    // Persist scroll position (throttled) so it survives a write-back re-render.
    const now = performance.now();
    if (now - lastSaved > 250) {
      lastSaved = now;
      state.scrollY = y;
      saveState();
    }
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

/* ------------------------------ Scroll sync ------------------------------- */

let lineElements: HTMLElement[] = [];
let suppressSync = false;
/** Timestamp of the last preview→editor sync we sent (to ignore its echo). */
let lastRevealSent = 0;
/** Page-load timestamp: don't emit sync while the initial scroll restores. */
const loadedAt = performance.now();

function indexLineElements(): void {
  lineElements = Array.from(document.querySelectorAll<HTMLElement>('[data-source-line]')).sort(
    (a, b) => Number(a.dataset.sourceLine) - Number(b.dataset.sourceLine),
  );
}

function scrollToSourceLine(line: number): void {
  if (lineElements.length === 0) {
    return;
  }
  let chosen: HTMLElement | null = null;
  for (const el of lineElements) {
    if (Number(el.dataset.sourceLine) <= line) {
      chosen = el;
    } else {
      break;
    }
  }
  const target = chosen ?? lineElements[0];
  suppressSync = true;
  const top = target.getBoundingClientRect().top + window.scrollY - 64;
  window.scrollTo({ top: Math.max(0, top), behavior: 'auto' });
  window.setTimeout(() => {
    suppressSync = false;
  }, 150);
}

/** Source line of the topmost block visible under the toolbar. */
function topVisibleSourceLine(): number | null {
  for (const el of lineElements) {
    if (el.offsetParent === null) {
      continue; // hidden (collapsed section)
    }
    const rect = el.getBoundingClientRect();
    if (rect.bottom > 70 && rect.height > 0) {
      const line = Number(el.dataset.sourceLine);
      return Number.isFinite(line) ? line : null;
    }
  }
  return null;
}

/** Preview → editor scroll sync (throttled; silent right after load/incoming sync). */
function initReverseScrollSync(): void {
  let lastSent = 0;
  window.addEventListener(
    'scroll',
    () => {
      if (suppressSync || performance.now() - loadedAt < 800) {
        return;
      }
      const now = performance.now();
      if (now - lastSent < 100) {
        return;
      }
      lastSent = now;
      const line = topVisibleSourceLine();
      if (line !== null) {
        lastRevealSent = now;
        vscode.postMessage({ type: 'revealLine', line });
      }
    },
    { passive: true },
  );
}

function initMessages(): void {
  window.addEventListener('message', (event) => {
    const message = event.data;
    if (message && message.type === 'scrollToLine' && typeof message.line === 'number') {
      // Ignore the editor's echo of a sync we just initiated ourselves.
      if (!suppressSync && performance.now() - lastRevealSent > 300) {
        scrollToSourceLine(message.line);
      }
    }
  });
}

/* ------------------------------ Find in page ------------------------------ */

let findHits: HTMLElement[] = [];
let findIndex = -1;
const FIND_MAX_HITS = 1000;

function updateFindCount(): void {
  const count = document.getElementById('find-count');
  if (!count) {
    return;
  }
  const input = document.getElementById('find-input') as HTMLInputElement | null;
  if (!input || input.value.length === 0) {
    count.textContent = '';
  } else if (findHits.length === 0) {
    count.textContent = '0 / 0';
  } else {
    count.textContent = `${findIndex + 1} / ${findHits.length}`;
  }
}

/** Remove all highlight marks and merge the text nodes back together. */
function clearFindHits(): void {
  for (const mark of findHits) {
    const parent = mark.parentNode;
    if (!parent) {
      continue;
    }
    parent.replaceChild(document.createTextNode(mark.textContent ?? ''), mark);
    parent.normalize();
  }
  findHits = [];
  findIndex = -1;
}

/** Expand any collapsed sections hiding `el` so it can be scrolled to. */
function revealHiddenSections(el: HTMLElement): void {
  for (let guard = 0; guard < 20; guard++) {
    const hidden = el.closest<HTMLElement>('.section-hidden');
    if (!hidden) {
      return;
    }
    let sib = hidden.previousElementSibling as HTMLElement | null;
    while (sib && !(isHeading(sib) && sib.classList.contains('collapsed'))) {
      sib = sib.previousElementSibling as HTMLElement | null;
    }
    if (sib) {
      setCollapsed(sib, false);
    } else {
      hidden.classList.remove('section-hidden');
    }
  }
}

function gotoFindHit(index: number): void {
  if (findHits.length === 0) {
    updateFindCount();
    return;
  }
  if (findIndex >= 0 && findHits[findIndex]) {
    findHits[findIndex].classList.remove('find-hit-current');
  }
  findIndex = ((index % findHits.length) + findHits.length) % findHits.length;
  const hit = findHits[findIndex];
  hit.classList.add('find-hit-current');
  revealHiddenSections(hit);
  hit.scrollIntoView({ block: 'center', behavior: 'auto' });
  updateFindCount();
}

/** Highlight every case-insensitive occurrence of `query` in the page text. */
function runFind(query: string): void {
  clearFindHits();
  if (query.length === 0) {
    updateFindCount();
    return;
  }
  const main = page();
  if (!main) {
    return;
  }
  const lower = query.toLowerCase();
  const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const parent = (node as Text).parentElement;
      // Skip UI chrome and KaTeX internals (their text is layout, not content).
      if (!parent || parent.closest('.block-editor, .format-toolbar, .block-handle, .katex')) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const textNodes: Text[] = [];
  while (walker.nextNode()) {
    textNodes.push(walker.currentNode as Text);
  }
  for (const node of textNodes) {
    if (findHits.length >= FIND_MAX_HITS) {
      break;
    }
    let current = node;
    let idx = (current.nodeValue ?? '').toLowerCase().indexOf(lower);
    while (idx !== -1 && findHits.length < FIND_MAX_HITS) {
      const hitText = current.splitText(idx);
      const rest = hitText.splitText(query.length);
      const mark = document.createElement('mark');
      mark.className = 'find-hit';
      hitText.parentNode?.replaceChild(mark, hitText);
      mark.appendChild(hitText);
      findHits.push(mark);
      current = rest;
      idx = (current.nodeValue ?? '').toLowerCase().indexOf(lower);
    }
  }
  gotoFindHit(0);
}

function toggleFindBar(force?: boolean): void {
  const bar = document.getElementById('find-bar');
  const input = document.getElementById('find-input') as HTMLInputElement | null;
  if (!bar || !input) {
    return;
  }
  const show = force ?? bar.hidden;
  if (show) {
    bar.hidden = false;
    const selection = window.getSelection()?.toString().trim() ?? '';
    if (selection && selection.length < 200) {
      input.value = selection;
    }
    input.focus();
    input.select();
    runFind(input.value);
  } else {
    bar.hidden = true;
    clearFindHits();
    updateFindCount();
  }
}

function initFindBar(): void {
  const bar = document.getElementById('find-bar');
  const input = document.getElementById('find-input') as HTMLInputElement | null;
  if (!bar || !input) {
    return;
  }

  let debounce: number | undefined;
  input.addEventListener('input', () => {
    window.clearTimeout(debounce);
    debounce = window.setTimeout(() => runFind(input.value), 150);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      gotoFindHit(findIndex + (e.shiftKey ? -1 : 1));
    }
  });

  bar.addEventListener('click', (e) => {
    const button = (e.target as HTMLElement).closest('button[data-find]');
    if (!button) {
      return;
    }
    const action = button.getAttribute('data-find');
    if (action === 'prev') {
      gotoFindHit(findIndex - 1);
    } else if (action === 'next') {
      gotoFindHit(findIndex + 1);
    } else if (action === 'close') {
      toggleFindBar(false);
    }
  });

  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && (e.key === 'f' || e.key === 'F')) {
      e.preventDefault();
      toggleFindBar(true);
    } else if (e.key === 'Escape' && !bar.hidden) {
      e.preventDefault();
      toggleFindBar(false);
    }
  });
}

/* ----------------------------- Copy buttons ------------------------------- */

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
}

function initCopyButtons(): void {
  document.querySelectorAll<HTMLButtonElement>('.copy-btn').forEach((button) => {
    button.addEventListener('click', async () => {
      const code = button.getAttribute('data-code') ?? '';
      try {
        await copyText(code);
        const original = button.textContent;
        button.textContent = 'Copied';
        button.classList.add('copied');
        window.setTimeout(() => {
          button.textContent = original;
          button.classList.remove('copied');
        }, 1500);
      } catch {
        button.textContent = 'Failed';
        window.setTimeout(() => {
          button.textContent = 'Copy';
        }, 1500);
      }
    });
  });
}

/* ------------------------------ Zoom lightbox ----------------------------- */

function openLightbox(innerHtml: string): void {
  const overlay = document.createElement('div');
  overlay.className = 'lightbox';

  const stage = document.createElement('div');
  stage.className = 'lightbox-stage';
  stage.innerHTML = innerHtml;

  const controls = document.createElement('div');
  controls.className = 'lightbox-controls';
  controls.innerHTML =
    '<button data-z="out" aria-label="Zoom out" title="Zoom out">−</button>' +
    '<button data-z="reset" aria-label="Reset zoom" title="Reset">⟳</button>' +
    '<button data-z="in" aria-label="Zoom in" title="Zoom in">＋</button>' +
    '<button data-z="close" aria-label="Close" title="Close (Esc)">✕</button>';

  const hint = document.createElement('div');
  hint.className = 'lightbox-hint';
  hint.textContent = 'scroll to zoom · drag to pan · Esc to close';

  overlay.appendChild(stage);
  overlay.appendChild(controls);
  overlay.appendChild(hint);
  document.body.appendChild(overlay);

  let scale = 1;
  let tx = 0;
  let ty = 0;
  const apply = () => {
    stage.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
  };
  const zoom = (factor: number) => {
    scale = Math.min(8, Math.max(0.2, scale * factor));
    apply();
  };

  requestAnimationFrame(() => {
    const node = stage.firstElementChild as HTMLElement | null;
    if (node) {
      const rect = node.getBoundingClientRect();
      const fit = Math.min(
        (window.innerWidth * 0.9) / rect.width,
        (window.innerHeight * 0.85) / rect.height,
        1.5,
      );
      scale = Number.isFinite(fit) && fit > 0 ? fit : 1;
      apply();
    }
  });

  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      close();
    } else if (e.key === '+' || e.key === '=') {
      zoom(1.2);
    } else if (e.key === '-') {
      zoom(1 / 1.2);
    }
  };
  document.addEventListener('keydown', onKey);

  controls.addEventListener('click', (e) => {
    const action = (e.target as HTMLElement).closest('button')?.getAttribute('data-z');
    if (action === 'in') {
      zoom(1.25);
    } else if (action === 'out') {
      zoom(1 / 1.25);
    } else if (action === 'reset') {
      scale = 1;
      tx = 0;
      ty = 0;
      apply();
    } else if (action === 'close') {
      close();
    }
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      close();
    }
  });

  overlay.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      zoom(e.deltaY < 0 ? 1.1 : 1 / 1.1);
    },
    { passive: false },
  );

  let dragging = false;
  let startX = 0;
  let startY = 0;
  stage.addEventListener('pointerdown', (e) => {
    dragging = true;
    startX = e.clientX - tx;
    startY = e.clientY - ty;
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointermove', (e) => {
    if (!dragging) {
      return;
    }
    tx = e.clientX - startX;
    ty = e.clientY - startY;
    apply();
  });
  stage.addEventListener('pointerup', () => {
    dragging = false;
  });
}

function initImageZoom(): void {
  const main = page();
  if (!main) {
    return;
  }
  main.querySelectorAll<HTMLImageElement>('.image-block img').forEach((img) => {
    img.classList.add('zoomable');
    img.addEventListener('click', () => {
      const src = img.getAttribute('src') ?? '';
      const alt = img.getAttribute('alt') ?? '';
      openLightbox(`<img src="${src}" alt="${escapeHtml(alt)}">`);
    });
  });
}

/* ------------------------------- Mermaid ---------------------------------- */

function cssVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.body).getPropertyValue(name).trim();
  return value || fallback;
}

/** Theme variables that make mermaid match the Notion-like / VS Code palette. */
function mermaidThemeVariables(): Record<string, string> {
  const dark = isDarkMode();
  const palette = dark
    ? { nodeBg: '#2b2d31', nodeBorder: '#4b4f57', text: '#e6e6e3', line: '#6b7280', alt: '#34373d', note: '#3a3520' }
    : { nodeBg: '#f7f6f3', nodeBorder: '#cfceca', text: '#37352f', line: '#9b9a97', alt: '#efeee9', note: '#fbf3db' };
  return {
    fontFamily: cssVar('--notion-font', 'sans-serif'),
    primaryColor: palette.nodeBg,
    primaryBorderColor: palette.nodeBorder,
    primaryTextColor: palette.text,
    secondaryColor: palette.alt,
    secondaryBorderColor: palette.nodeBorder,
    secondaryTextColor: palette.text,
    tertiaryColor: palette.alt,
    tertiaryBorderColor: palette.nodeBorder,
    tertiaryTextColor: palette.text,
    lineColor: palette.line,
    textColor: palette.text,
    noteBkgColor: palette.note,
    noteTextColor: palette.text,
    noteBorderColor: palette.nodeBorder,
    background: 'transparent',
  };
}

const TOOL_BUTTONS =
  '<button data-m="out" title="Zoom out" aria-label="Zoom out">−</button>' +
  '<button data-m="in" title="Zoom in" aria-label="Zoom in">＋</button>' +
  '<button data-m="fit" title="Fit to view" aria-label="Fit">⤢</button>' +
  '<button data-m="source" title="Show mermaid source" aria-label="Source">{ }</button>' +
  '<button data-m="save" title="Save as SVG" aria-label="Save SVG">↓</button>' +
  '<button data-m="full" title="Fullscreen" aria-label="Fullscreen">⛶</button>';

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function setupMermaidBlock(block: HTMLElement, source: string, svgHtml: string): void {
  const label = block.querySelector<HTMLElement>('.block-label');
  const pre = block.querySelector<HTMLElement>('pre.mermaid');
  if (!label || !pre) {
    return;
  }

  const tools = document.createElement('div');
  tools.className = 'mermaid-tools';
  tools.innerHTML = TOOL_BUTTONS;
  label.appendChild(tools);

  const viewport = document.createElement('div');
  viewport.className = 'mermaid-viewport';
  const pan = document.createElement('div');
  pan.className = 'mermaid-pan';
  pan.innerHTML = svgHtml;
  viewport.appendChild(pan);

  const srcPre = document.createElement('pre');
  srcPre.className = 'mermaid-source';
  srcPre.hidden = true;
  const code = document.createElement('code');
  code.textContent = source;
  srcPre.appendChild(code);

  pre.replaceWith(viewport);
  block.appendChild(srcPre);

  let scale = 1;
  let tx = 0;
  let ty = 0;
  const apply = () => {
    pan.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
  };
  const zoomAt = (factor: number, cx: number, cy: number) => {
    const ns = clamp(scale * factor, 0.2, 8);
    tx = cx - (cx - tx) * (ns / scale);
    ty = cy - (cy - ty) * (ns / scale);
    scale = ns;
    apply();
  };
  const fit = () => {
    scale = 1;
    tx = 0;
    ty = 0;
    apply();
    const svg = pan.querySelector('svg');
    if (!svg) {
      return;
    }
    const r = svg.getBoundingClientRect();
    viewport.style.height = `${Math.min(r.height + 8, 460)}px`;
    const vp = viewport.getBoundingClientRect();
    if (r.width && r.height) {
      scale = clamp(Math.min(vp.width / r.width, vp.height / r.height, 1), 0.2, 8);
      tx = (vp.width - r.width * scale) / 2;
      ty = (vp.height - r.height * scale) / 2;
      apply();
    }
  };

  requestAnimationFrame(fit);

  // Wheel zoom centred on the cursor.
  viewport.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const rect = viewport.getBoundingClientRect();
      zoomAt(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX - rect.left, e.clientY - rect.top);
    },
    { passive: false },
  );

  // Drag to pan.
  let dragging = false;
  let sx = 0;
  let sy = 0;
  viewport.addEventListener('pointerdown', (e) => {
    dragging = true;
    sx = e.clientX - tx;
    sy = e.clientY - ty;
    viewport.setPointerCapture(e.pointerId);
  });
  viewport.addEventListener('pointermove', (e) => {
    if (!dragging) {
      return;
    }
    tx = e.clientX - sx;
    ty = e.clientY - sy;
    apply();
  });
  viewport.addEventListener('pointerup', () => {
    dragging = false;
  });

  const sourceBtn = tools.querySelector<HTMLElement>('button[data-m="source"]');
  tools.addEventListener('click', (e) => {
    const action = (e.target as HTMLElement).closest('button')?.getAttribute('data-m');
    const rect = viewport.getBoundingClientRect();
    switch (action) {
      case 'in':
        zoomAt(1.25, rect.width / 2, rect.height / 2);
        break;
      case 'out':
        zoomAt(1 / 1.25, rect.width / 2, rect.height / 2);
        break;
      case 'fit':
        fit();
        break;
      case 'source': {
        const showing = !srcPre.hidden;
        srcPre.hidden = showing;
        viewport.hidden = !showing;
        sourceBtn?.classList.toggle('active', !showing);
        break;
      }
      case 'save':
        vscode.postMessage({ type: 'saveSvg', svg: svgHtml, name: 'diagram.svg' });
        break;
      case 'full': {
        const svg = pan.querySelector('svg');
        if (svg) {
          openLightbox(svg.outerHTML);
        }
        break;
      }
      default:
        break;
    }
  });
}

async function renderMermaid(): Promise<void> {
  if (!config.enableMermaid) {
    return;
  }
  const blocks = Array.from(document.querySelectorAll<HTMLElement>('.mermaid-block'));
  if (blocks.length === 0) {
    return;
  }
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    themeVariables: mermaidThemeVariables(),
    fontFamily: cssVar('--notion-font', 'sans-serif'),
  });
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const pre = block.querySelector<HTMLElement>('pre.mermaid');
    if (!pre) {
      continue;
    }
    const source = pre.getAttribute('data-mermaid-src') ?? pre.textContent ?? '';
    try {
      const { svg } = await mermaid.render(`notion-mermaid-${i}`, source);
      setupMermaidBlock(block, source, svg);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const errorEl = document.createElement('div');
      errorEl.className = 'mermaid-error';
      errorEl.innerHTML =
        '<div class="mermaid-error-title">Mermaid syntax error</div>' + escapeHtml(message);
      pre.replaceWith(errorEl);
    }
  }
  indexLineElements();
}

/* ------------------------------- Bootstrap -------------------------------- */

/**
 * Resolve a `#fragment` to an element. Tries the exact slug id first, then
 * falls back to matching heading text, so hand-written anchors like `#概要`
 * still reach "## 1. 概要" (slug `1-概要`).
 */
function resolveAnchor(fragment: string): HTMLElement | null {
  let id = fragment;
  try {
    id = decodeURIComponent(fragment);
  } catch {
    // keep the raw fragment
  }
  const needle = id.trim().toLowerCase();
  const headings = Array.from(
    document.querySelectorAll<HTMLElement>('h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]'),
  );
  const headingText = (h: HTMLElement) => (h.dataset.title ?? h.textContent ?? '').trim().toLowerCase();
  return (
    document.getElementById(id) ??
    document.getElementById(needle.replace(/\s+/g, '-')) ??
    headings.find((h) => headingText(h) === needle) ??
    headings.find((h) => headingText(h).includes(needle)) ??
    null
  );
}

/* ------------------------ Git change highlights ------------------------ */

function rangesIntersect(start: number, end: number, ranges: Array<[number, number]>): boolean {
  return ranges.some(([rs, re]) => rs < end && re >= start);
}

/** Collapsed "N deleted lines" element; clicking it reveals the removed text. */
function buildDeletedChunk(chunk: { line: number; text: string; pure: boolean }): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'git-deleted-chunk';

  const count = chunk.text.length === 0 ? 0 : chunk.text.split('\n').length;
  const label = chunk.pure
    ? `${count} deleted line${count === 1 ? '' : 's'}`
    : `${count} replaced line${count === 1 ? '' : 's'} (previous version)`;

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'git-deleted-toggle';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.textContent = `▸ ${label}`;

  const content = document.createElement('pre');
  content.className = 'git-deleted-content';
  content.hidden = true;
  content.textContent = chunk.text; // textContent — the removed source is never parsed as HTML

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    content.hidden = !content.hidden;
    toggle.textContent = `${content.hidden ? '▸' : '▾'} ${label}`;
    toggle.setAttribute('aria-expanded', String(!content.hidden));
  });

  wrap.appendChild(toggle);
  wrap.appendChild(content);
  return wrap;
}

/**
 * Mark blocks changed since HEAD with a green bar, and insert collapsible
 * "deleted lines" chips where content was removed. Visibility is controlled
 * purely by the body class (`show-git-changes`), so the ± toggle is instant
 * with no re-render.
 */
function applyGitChanges(): void {
  const gc = config.gitChanges;
  const gitBtn = document.querySelector<HTMLButtonElement>('button[data-action="toggle-git"]');
  if (!gc) {
    // Not a git repo / untracked file: the feature has no baseline, hide it.
    if (gitBtn) {
      gitBtn.style.display = 'none';
    }
    return;
  }
  const main = page();
  if (!main) {
    return;
  }
  const blocks = (Array.from(main.children) as HTMLElement[]).filter(
    (block) =>
      Number.isFinite(Number(block.dataset.sourceLine)) &&
      Number.isFinite(Number(block.dataset.sourceEnd)),
  );

  // Added and modified both get the green "changed" bar (kept as one color by
  // design — the distinction was more confusing than useful at block level).
  for (const block of blocks) {
    const start = Number(block.dataset.sourceLine);
    const end = Number(block.dataset.sourceEnd);
    if (rangesIntersect(start, end, gc.added) || rangesIntersect(start, end, gc.modified)) {
      block.classList.add('git-added');
    }
  }

  // Insert a chip at each deletion point: before the block containing the
  // line below the deletion (which may be a blank line belonging to no block —
  // then before the next block), or at the end of the page for EOF deletions.
  for (const chunk of gc.deleted) {
    const ref =
      blocks.find((block) => chunk.line < Number(block.dataset.sourceEnd)) ?? null;
    main.insertBefore(buildDeletedChunk(chunk), ref);
  }
}

/** Scroll to the `#fragment` this preview was opened with (from a doc link). */
function scrollToInitialAnchor(anchor: string): void {
  const el = resolveAnchor(anchor);
  if (el) {
    suppressSync = true;
    el.scrollIntoView({ block: 'start', behavior: 'auto' });
    window.setTimeout(() => {
      suppressSync = false;
    }, 150);
  }
}

function main(): void {
  applyState();
  initHeadings();
  buildToc();
  updateDocMeta();
  initLinks();
  initToolbar();
  initFindBar();
  initScrollChrome();
  initCopyButtons();
  initImageZoom();
  initMessages();
  initReverseScrollSync();
  setupBlockDragging();
  initCheckboxes();
  initInlineEditing();
  initUndoForwarding();
  indexLineElements();
  applyGitChanges();
  void renderMermaid();
  if (config.initialAnchor) {
    // A `#fragment` link takes precedence over the remembered scroll position.
    requestAnimationFrame(() => scrollToInitialAnchor(config.initialAnchor!));
  } else if (state.scrollY > 0) {
    // Restore the scroll position after a write-back re-render.
    requestAnimationFrame(() => window.scrollTo(0, state.scrollY));
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main);
} else {
  main();
}
