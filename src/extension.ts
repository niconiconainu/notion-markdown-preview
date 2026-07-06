import * as vscode from 'vscode';
import { PreviewPanelManager } from './preview/PreviewPanelManager';

export function activate(context: vscode.ExtensionContext): void {
  const manager = new PreviewPanelManager(context);

  const disposable = vscode.commands.registerCommand(
    'notionPreview.open',
    async (uri?: vscode.Uri) => {
      const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;

      if (!targetUri) {
        vscode.window.showWarningMessage('Open a Markdown file first.');
        return;
      }

      let document: vscode.TextDocument;
      try {
        document = await vscode.workspace.openTextDocument(targetUri);
      } catch {
        vscode.window.showWarningMessage('Could not open the selected file.');
        return;
      }

      if (document.languageId !== 'markdown' && path_ext(targetUri) !== '.md') {
        vscode.window.showWarningMessage('Notion Preview supports Markdown files only.');
        return;
      }

      manager.open(document);
    },
  );

  context.subscriptions.push(disposable);

  context.subscriptions.push(
    vscode.commands.registerCommand('notionPreview.toggleTheme', () => manager.toggleTheme()),
  );

  // Status bar entry: a one-click launcher shown only for Markdown files.
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = 'notionPreview.open';
  statusBar.text = '$(book) Notion Preview';
  statusBar.tooltip = 'Open Notion Preview (Cmd/Ctrl+K N)';

  const updateStatusBar = () => {
    const editor = vscode.window.activeTextEditor;
    if (editor && editor.document.languageId === 'markdown') {
      statusBar.show();
    } else {
      statusBar.hide();
    }
  };

  context.subscriptions.push(
    statusBar,
    vscode.window.onDidChangeActiveTextEditor(updateStatusBar),
  );
  updateStatusBar();
}

/** Lightweight extension check so the command also works when invoked on a URI. */
function path_ext(uri: vscode.Uri): string {
  const name = uri.path;
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot).toLowerCase();
}

export function deactivate(): void {
  // Panels are disposed via context.subscriptions.
}
