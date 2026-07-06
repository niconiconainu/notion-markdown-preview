import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { renderMarkdown } from './renderMarkdown';
import { parseUnifiedDiff, type GitChangeRanges } from './gitDiff';
import { resolveAssets } from './resolveAssets';
import { createWebviewHtml, createMissingFileHtml } from './createWebviewHtml';
import { getNonce } from './getNonce';
import { moveBlock, replaceLines, toggleTaskLine } from './blockEdit';

interface PreviewEntry {
  panel: vscode.WebviewPanel;
  uri: vscode.Uri;
}

interface PreviewConfig {
  theme: 'auto' | 'light' | 'dark';
  pageWidth: number;
  enableMermaid: boolean;
  enableRawHtml: boolean;
  enableMath: boolean;
  showFrontmatter: boolean;
  openLinksInPreview: boolean;
  updateMode: 'onSave' | 'debounced';
}

const VIEW_TYPE = 'notionPreview';
const DEBOUNCE_MS = 300;

const execFileAsync = promisify(execFile);
const GIT_MAX_BUFFER = 10 * 1024 * 1024;

/**
 * Owns the lifecycle of all preview panels: creation, refresh, theme/config
 * reactivity, and disposal. This is the only place (besides extension.ts) that
 * depends on the `vscode` API (NFR-401).
 */
export class PreviewPanelManager {
  private readonly entries: PreviewEntry[] = [];
  private readonly debounceTimers = new Map<string, NodeJS.Timeout>();
  private readonly disposables: vscode.Disposable[] = [];
  // Per-document history of edits made through the preview, so Ctrl+Z can undo
  // them without stealing focus away from the WebView.
  private readonly undoStacks = new Map<string, string[]>();
  private readonly redoStacks = new Map<string, string[]>();
  private static readonly MAX_HISTORY = 100;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.disposables.push(
      vscode.workspace.onDidSaveTextDocument((doc) => this.onDocumentSaved(doc)),
      vscode.workspace.onDidChangeTextDocument((event) => this.onDocumentChanged(event)),
      vscode.workspace.onDidChangeConfiguration((event) => this.onConfigChanged(event)),
      vscode.window.onDidChangeActiveColorTheme(() => this.refreshAll()),
      vscode.window.onDidChangeTextEditorVisibleRanges((event) => this.onEditorScrolled(event)),
      vscode.workspace.onDidDeleteFiles((event) => this.onFilesDeleted(event)),
    );
    context.subscriptions.push(...this.disposables);
  }

  /**
   * Open a preview for a Markdown document. Each document gets its own panel,
   * so previews of several files can stay open side by side; re-running the
   * command on a document whose preview is already open just reveals it.
   */
  public open(document: vscode.TextDocument, column?: vscode.ViewColumn, anchor?: string): void {
    const existing = this.entriesFor(document.uri)[0];
    if (existing) {
      existing.panel.reveal(existing.panel.viewColumn ?? vscode.ViewColumn.Beside, true);
      void this.refresh(existing, anchor);
      return;
    }
    const entry = this.createPanel(document.uri, column);
    void this.refresh(entry, anchor);
  }

  /** Create a new preview panel bound to a document. */
  private createPanel(
    uri: vscode.Uri,
    column: vscode.ViewColumn = vscode.ViewColumn.Beside,
  ): PreviewEntry {
    const panel = vscode.window.createWebviewPanel(
      VIEW_TYPE,
      this.title(uri),
      { viewColumn: column, preserveFocus: true },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: this.localResourceRoots(uri),
      },
    );

    const entry: PreviewEntry = { panel, uri };
    this.entries.push(entry);

    panel.webview.onDidReceiveMessage(
      (message) => this.onWebviewMessage(entry, message),
      null,
      this.context.subscriptions,
    );

    panel.onDidDispose(() => {
      const index = this.entries.indexOf(entry);
      if (index >= 0) {
        this.entries.splice(index, 1);
      }
      const key = entry.uri.toString();
      const timer = this.debounceTimers.get(key);
      if (timer) {
        clearTimeout(timer);
        this.debounceTimers.delete(key);
      }
    }, null, this.context.subscriptions);

    return entry;
  }

  private title(uri: vscode.Uri): string {
    return `Preview ${path.basename(uri.fsPath)}`;
  }

  private localResourceRoots(uri: vscode.Uri): vscode.Uri[] {
    const roots: vscode.Uri[] = [
      vscode.Uri.joinPath(this.context.extensionUri, 'media'),
      vscode.Uri.file(path.dirname(uri.fsPath)),
    ];
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (folder) {
      roots.push(folder.uri);
    }
    return roots;
  }

  private getConfig(uri: vscode.Uri): PreviewConfig {
    const cfg = vscode.workspace.getConfiguration('notionPreview', uri);
    return {
      theme: cfg.get<'auto' | 'light' | 'dark'>('theme', 'auto'),
      pageWidth: cfg.get<number>('pageWidth', 800),
      enableMermaid: cfg.get<boolean>('enableMermaid', true),
      enableRawHtml: cfg.get<boolean>('enableRawHtml', false),
      enableMath: cfg.get<boolean>('enableMath', true),
      showFrontmatter: cfg.get<boolean>('showFrontmatter', true),
      openLinksInPreview: cfg.get<boolean>('openLinksInPreview', true),
      updateMode: cfg.get<'onSave' | 'debounced'>('updateMode', 'onSave'),
    };
  }

  private vscodeIsDark(): boolean {
    const kind = vscode.window.activeColorTheme.kind;
    return kind === vscode.ColorThemeKind.Dark || kind === vscode.ColorThemeKind.HighContrast;
  }

  private effectiveIsDark(theme: PreviewConfig['theme']): boolean {
    if (theme === 'dark') {
      return true;
    }
    if (theme === 'light') {
      return false;
    }
    return this.vscodeIsDark();
  }

  /**
   * Changed line ranges of the file's working tree vs HEAD (VS Code
   * gutter-style). Returns `null` (feature hidden) when the file is not in a
   * git repository, is untracked, or git is unavailable.
   */
  private async computeGitChanges(uri: vscode.Uri): Promise<GitChangeRanges | null> {
    try {
      const dir = path.dirname(uri.fsPath);
      const { stdout: top } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], {
        cwd: dir,
      });
      const root = top.trim();
      const rel = path.relative(root, uri.fsPath);
      // Untracked files have no baseline to diff against — hide the feature.
      await execFileAsync('git', ['ls-files', '--error-unmatch', '--', rel], { cwd: root });
      const { stdout } = await execFileAsync(
        'git',
        ['diff', '--unified=0', 'HEAD', '--', rel],
        { cwd: root, maxBuffer: GIT_MAX_BUFFER },
      );
      return parseUnifiedDiff(stdout);
    } catch {
      return null;
    }
  }

  /** Re-render a single preview from the current document contents. */
  private async refresh(entry: PreviewEntry, anchor?: string): Promise<void> {
    const { panel, uri } = entry;
    const config = this.getConfig(uri);
    const webview = panel.webview;
    const nonce = getNonce();
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'preview.css')).toString();
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'preview.js')).toString();
    const katexCssUri = config.enableMath
      ? webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'vendor', 'katex', 'katex.min.css')).toString()
      : undefined;
    const title = this.title(uri);

    // The file may have been deleted out from under us (FR-603).
    if (!fs.existsSync(uri.fsPath)) {
      webview.html = createMissingFileHtml({
        nonce,
        cspSource: webview.cspSource,
        styleUri,
        theme: config.theme,
        pageWidth: config.pageWidth,
        title,
      });
      return;
    }

    try {
      const document = await vscode.workspace.openTextDocument(uri);
      const source = document.getText();
      const isDark = this.effectiveIsDark(config.theme);
      const baseDir = path.dirname(uri.fsPath);
      const pageName = path.basename(uri.fsPath, path.extname(uri.fsPath));
      const gitChanges = await this.computeGitChanges(uri);

      const bodyHtml = await renderMarkdown(source, {
        enableMermaid: config.enableMermaid,
        enableRawHtml: config.enableRawHtml,
        enableMath: config.enableMath,
        showFrontmatter: config.showFrontmatter,
        isDark,
        resolveImage: (rawSrc) => {
          const resolved = resolveAssets(rawSrc, { baseDir, pageName });
          return resolved ? webview.asWebviewUri(vscode.Uri.file(resolved)).toString() : null;
        },
      });

      webview.html = createWebviewHtml({
        bodyHtml,
        nonce,
        cspSource: webview.cspSource,
        styleUri,
        scriptUri,
        katexCssUri,
        initialAnchor: anchor,
        gitChanges,
        theme: config.theme,
        pageWidth: config.pageWidth,
        enableMermaid: config.enableMermaid,
        isDark,
        title,
        source,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`Notion Preview failed to render: ${message}`);
      webview.html = createWebviewHtml({
        bodyHtml:
          '<div class="missing-image"><span class="missing-image-icon">⚠️</span>' +
          `<span class="missing-image-label">Failed to render preview: ${this.escape(message)}</span></div>`,
        nonce,
        cspSource: webview.cspSource,
        styleUri,
        scriptUri,
        theme: config.theme,
        pageWidth: config.pageWidth,
        enableMermaid: false,
        isDark: this.effectiveIsDark(config.theme),
        title,
        source: '',
      });
    }
  }

  private escape(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  private refreshAll(): void {
    for (const entry of [...this.entries]) {
      void this.refresh(entry);
    }
  }

  private entriesFor(uri: vscode.Uri): PreviewEntry[] {
    const key = uri.toString();
    return this.entries.filter((entry) => entry.uri.toString() === key);
  }

  private onDocumentSaved(doc: vscode.TextDocument): void {
    for (const entry of this.entriesFor(doc.uri)) {
      void this.refresh(entry);
    }
  }

  private onDocumentChanged(event: vscode.TextDocumentChangeEvent): void {
    const key = event.document.uri.toString();
    const matching = this.entriesFor(event.document.uri);
    if (matching.length === 0) {
      return;
    }
    const config = this.getConfig(event.document.uri);
    if (config.updateMode !== 'debounced') {
      return;
    }
    const existingTimer = this.debounceTimers.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    this.debounceTimers.set(
      key,
      setTimeout(() => {
        this.debounceTimers.delete(key);
        for (const entry of this.entriesFor(event.document.uri)) {
          void this.refresh(entry);
        }
      }, DEBOUNCE_MS),
    );
  }

  private onConfigChanged(event: vscode.ConfigurationChangeEvent): void {
    if (event.affectsConfiguration('notionPreview')) {
      this.refreshAll();
    }
  }

  private onFilesDeleted(event: vscode.FileDeleteEvent): void {
    for (const deleted of event.files) {
      for (const entry of this.entriesFor(deleted)) {
        void this.refresh(entry);
      }
    }
  }

  /* --------------------------- WebView messaging --------------------------- */

  private onWebviewMessage(entry: PreviewEntry, message: unknown): void {
    if (!message || typeof message !== 'object') {
      return;
    }
    const msg = message as {
      type?: string;
      href?: string;
      external?: boolean;
      svg?: string;
      name?: string;
      fromStart?: number;
      fromEnd?: number;
      toStart?: number;
      start?: number;
      end?: number;
      text?: string;
      line?: number;
    };
    if (msg.type === 'openLink' && typeof msg.href === 'string') {
      void this.openLink(entry, msg.href, msg.external === true);
    } else if (msg.type === 'saveSvg' && typeof msg.svg === 'string') {
      void this.saveSvg(entry, msg.svg, msg.name);
    } else if (
      msg.type === 'moveBlock' &&
      typeof msg.fromStart === 'number' &&
      typeof msg.fromEnd === 'number' &&
      typeof msg.toStart === 'number'
    ) {
      void this.moveBlock(entry, msg.fromStart, msg.fromEnd, msg.toStart);
    } else if (
      msg.type === 'replaceRange' &&
      typeof msg.start === 'number' &&
      typeof msg.end === 'number' &&
      typeof msg.text === 'string'
    ) {
      void this.editDocument(entry, (text) => replaceLines(text, msg.start!, msg.end!, msg.text!));
    } else if (msg.type === 'toggleCheckbox' && typeof msg.line === 'number') {
      void this.editDocument(entry, (text) => toggleTaskLine(text, msg.line!));
    } else if (msg.type === 'revealLine' && typeof msg.line === 'number') {
      this.revealEditorLine(entry, msg.line);
    } else if (msg.type === 'undo' || msg.type === 'redo') {
      void this.runUndoRedo(entry, msg.type);
    } else if (msg.type === 'toggleTheme') {
      void this.toggleTheme();
    }
  }

  /**
   * Flip the preview between light and dark. The choice is persisted to the
   * `notionPreview.theme` setting — written to the narrowest scope that
   * currently defines it, so a workspace-level value can never mask the
   * toggle — and every preview follows via the configuration-change listener.
   */
  public async toggleTheme(): Promise<void> {
    const scopeUri = this.entries[0]?.uri;
    const cfg = vscode.workspace.getConfiguration('notionPreview', scopeUri);
    const theme = cfg.get<'auto' | 'light' | 'dark'>('theme', 'auto');
    const next = this.effectiveIsDark(theme) ? 'light' : 'dark';

    const info = cfg.inspect<'auto' | 'light' | 'dark'>('theme');
    let target = vscode.ConfigurationTarget.Global;
    if (info?.workspaceFolderValue !== undefined) {
      target = vscode.ConfigurationTarget.WorkspaceFolder;
    } else if (info?.workspaceValue !== undefined) {
      target = vscode.ConfigurationTarget.Workspace;
    }

    try {
      await cfg.update('theme', next, target);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`Could not switch preview theme: ${reason}`);
      return;
    }
    // onConfigChanged re-renders too, but refresh directly so the toggle works
    // even if the configuration event is missed.
    this.refreshAll();
  }

  /**
   * Apply a pure text transformation to the document as a single minimal-diff,
   * undoable `WorkspaceEdit` (not auto-saved).
   */
  private pushHistory(stack: Map<string, string[]>, key: string, value: string): void {
    const arr = stack.get(key) ?? [];
    arr.push(value);
    if (arr.length > PreviewPanelManager.MAX_HISTORY) {
      arr.shift();
    }
    stack.set(key, arr);
  }

  private async editDocument(
    entry: PreviewEntry,
    transform: (text: string) => string,
  ): Promise<void> {
    let document: vscode.TextDocument;
    try {
      document = await vscode.workspace.openTextDocument(entry.uri);
    } catch {
      return;
    }
    const current = document.getText();
    const next = transform(current);
    if (next === current) {
      return;
    }
    const key = entry.uri.toString();
    this.pushHistory(this.undoStacks, key, current);
    this.redoStacks.set(key, []); // a fresh edit invalidates redo history
    await this.applyText(entry, document, current, next);
  }

  /** Replace only the changed region (minimal diff) and refresh every preview. */
  private async applyText(
    entry: PreviewEntry,
    document: vscode.TextDocument,
    current: string,
    next: string,
  ): Promise<void> {
    let prefix = 0;
    const minLen = Math.min(current.length, next.length);
    while (prefix < minLen && current[prefix] === next[prefix]) {
      prefix += 1;
    }
    let suffix = 0;
    while (
      suffix < minLen - prefix &&
      current[current.length - 1 - suffix] === next[next.length - 1 - suffix]
    ) {
      suffix += 1;
    }
    const range = new vscode.Range(
      document.positionAt(prefix),
      document.positionAt(current.length - suffix),
    );
    const edit = new vscode.WorkspaceEdit();
    edit.replace(entry.uri, range, next.slice(prefix, next.length - suffix));
    await vscode.workspace.applyEdit(edit);

    // Programmatic edits don't "save", so onSave-mode previews would otherwise
    // never reflect them — refresh every preview of this document now.
    for (const target of this.entriesFor(entry.uri)) {
      void this.refresh(target);
    }
  }

  /**
   * Undo/redo edits made through the preview. Applied as a `WorkspaceEdit` so
   * focus stays in the WebView (no jumping away to the text editor).
   */
  private async runUndoRedo(entry: PreviewEntry, kind: 'undo' | 'redo'): Promise<void> {
    const key = entry.uri.toString();
    const from = kind === 'undo' ? this.undoStacks : this.redoStacks;
    const to = kind === 'undo' ? this.redoStacks : this.undoStacks;
    const stack = from.get(key);
    if (!stack || stack.length === 0) {
      return;
    }
    let document: vscode.TextDocument;
    try {
      document = await vscode.workspace.openTextDocument(entry.uri);
    } catch {
      return;
    }
    const current = document.getText();
    const target = stack.pop()!;
    this.pushHistory(to, key, current);
    await this.applyText(entry, document, current, target);
  }

  /** Apply a block reorder to the underlying document (undoable, not auto-saved). */
  private async moveBlock(
    entry: PreviewEntry,
    fromStart: number,
    fromEnd: number,
    toStart: number,
  ): Promise<void> {
    await this.editDocument(entry, (text) => moveBlock(text, fromStart, fromEnd, toStart));
  }

  /** Save a rendered mermaid diagram to disk via a native save dialog. */
  private async saveSvg(entry: PreviewEntry, svg: string, name?: string): Promise<void> {
    // Defense-in-depth: a compromised webview shouldn't be able to spray
    // gigabytes to disk through this channel.
    if (svg.length > 20 * 1024 * 1024) {
      vscode.window.showWarningMessage('SVG too large to save (limit: 20 MB).');
      return;
    }
    const dir = path.dirname(entry.uri.fsPath);
    const defaultUri = vscode.Uri.file(path.join(dir, name && name.endsWith('.svg') ? name : 'diagram.svg'));
    const target = await vscode.window.showSaveDialog({
      defaultUri,
      filters: { 'SVG image': ['svg'] },
    });
    if (!target) {
      return;
    }
    try {
      await vscode.workspace.fs.writeFile(target, Buffer.from(svg, 'utf8'));
      vscode.window.showInformationMessage(`Saved ${path.basename(target.fsPath)}`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`Could not save SVG: ${reason}`);
    }
  }

  /** URL schemes a preview link is allowed to hand to the OS. Anything else
   *  (`command:`, `vscode:`, `file:`…) could execute actions on the user's
   *  behalf when opening a malicious document, so it is dropped. */
  private static readonly SAFE_EXTERNAL_SCHEMES = new Set(['http', 'https', 'mailto']);

  /** True when `target` lives inside the workspace or the document's folder.
   *  Blocks `../../../` traversal links in untrusted Markdown from opening
   *  arbitrary files on disk. */
  private isLocalTargetAllowed(entry: PreviewEntry, target: string): boolean {
    const roots = [
      path.dirname(entry.uri.fsPath),
      ...(vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath),
    ];
    return roots.some((root) => {
      const rel = path.relative(root, target);
      return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
    });
  }

  /**
   * Open a link clicked in the preview: external links in the browser; local
   * Markdown links in another preview panel (configurable), so linked specs can
   * be browsed Notion-style; everything else in the editor.
   */
  private async openLink(entry: PreviewEntry, href: string, external: boolean): Promise<void> {
    if (external) {
      let parsed: vscode.Uri;
      try {
        parsed = vscode.Uri.parse(href, true);
      } catch {
        return;
      }
      if (!PreviewPanelManager.SAFE_EXTERNAL_SCHEMES.has(parsed.scheme.toLowerCase())) {
        vscode.window.showWarningMessage(
          `Blocked link with unsupported scheme "${parsed.scheme}:" for security.`,
        );
        return;
      }
      await vscode.env.openExternal(parsed);
      return;
    }

    // Resolve a workspace-relative / document-relative path.
    const [rawPath, fragment] = href.split('#');
    if (!rawPath) {
      return;
    }
    let target: string;
    try {
      target = decodeURIComponent(rawPath);
    } catch {
      target = rawPath;
    }
    const baseDir = path.dirname(entry.uri.fsPath);
    const resolved = path.resolve(baseDir, target);

    if (!this.isLocalTargetAllowed(entry, resolved)) {
      vscode.window.showWarningMessage(
        `Blocked link outside the workspace: ${target}`,
      );
      return;
    }

    if (!fs.existsSync(resolved)) {
      vscode.window.showWarningMessage(`File not found: ${target}`);
      return;
    }

    try {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(resolved));
      const config = this.getConfig(entry.uri);
      if (config.openLinksInPreview && doc.languageId === 'markdown') {
        // Open the linked document as a preview tab in the same group.
        this.open(doc, entry.panel.viewColumn ?? vscode.ViewColumn.Beside, fragment);
        return;
      }
      await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      vscode.window.showWarningMessage(`Could not open ${target}: ${reason}`);
    }
  }

  /* ------------------------------ Scroll sync ------------------------------ */

  /** Per-document timestamp of the last preview-initiated editor reveal, to
   *  swallow the editor-scroll echo it produces (which would bounce back to
   *  the preview and fight the user's scrolling). */
  private readonly lastPreviewReveal = new Map<string, number>();
  private static readonly REVEAL_ECHO_MS = 250;

  private onEditorScrolled(event: vscode.TextEditorVisibleRangesChangeEvent): void {
    const uri = event.textEditor.document.uri;
    const ranges = event.visibleRanges;
    if (ranges.length === 0) {
      return;
    }
    const lastReveal = this.lastPreviewReveal.get(uri.toString()) ?? 0;
    if (Date.now() - lastReveal < PreviewPanelManager.REVEAL_ECHO_MS) {
      return;
    }
    const topLine = ranges[0].start.line;
    for (const entry of this.entriesFor(uri)) {
      entry.panel.webview.postMessage({ type: 'scrollToLine', line: topLine });
    }
  }

  /** Preview → editor scroll sync: reveal the block's source line on top. */
  private revealEditorLine(entry: PreviewEntry, line: number): void {
    const key = entry.uri.toString();
    const editors = vscode.window.visibleTextEditors.filter(
      (editor) => editor.document.uri.toString() === key,
    );
    if (editors.length === 0) {
      return;
    }
    this.lastPreviewReveal.set(key, Date.now());
    for (const editor of editors) {
      const clamped = Math.max(0, Math.min(line, editor.document.lineCount - 1));
      const range = new vscode.Range(clamped, 0, clamped, 0);
      editor.revealRange(range, vscode.TextEditorRevealType.AtTop);
    }
  }
}
