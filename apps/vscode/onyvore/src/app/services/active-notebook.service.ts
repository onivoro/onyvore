import { Injectable, Inject, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import {
  VSCODE_API,
  VscodeApi,
  BaseWebviewProvider,
  WEBVIEW_PROVIDER,
} from '@onivoro/server-vscode';
import { MESSAGE_BUS, MessageBus } from '@onivoro/isomorphic-jsonrpc';
import { onyvoreRpcMethods } from '@onivoro/isomorphic-onyvore';
import { NotebookDiscoveryService } from './notebook-discovery.service';
import * as path from 'path';

@Injectable()
export class ActiveNotebookService implements OnModuleInit, OnModuleDestroy {
  private activeNotebookId: string | null = null;
  private activeNotePath: string | null = null;
  private statusBarItem: any = null;
  private disposable: any = null;

  constructor(
    @Inject(VSCODE_API) private readonly vscode: VscodeApi,
    @Inject(MESSAGE_BUS) private readonly messageBus: MessageBus,
    @Inject(WEBVIEW_PROVIDER) private readonly webviewProvider: BaseWebviewProvider,
    private readonly notebookDiscovery: NotebookDiscoveryService,
  ) {}

  onModuleInit(): void {
    // Create status bar item
    this.statusBarItem = this.vscode.window.createStatusBarItem(
      this.vscode.StatusBarAlignment.Right,
      100,
    );
    this.statusBarItem.show();
    this.updateStatusBar();

    // Listen for active editor changes
    this.disposable = this.vscode.window.onDidChangeActiveTextEditor(
      (editor: any) => {
        this.onEditorChanged(editor);
      },
    );

    // Set initial state from current editor
    const currentEditor = this.vscode.window.activeTextEditor;
    if (currentEditor) {
      this.onEditorChanged(currentEditor);
    }

    // Recheck when notebooks become available (discovery/init may complete after this runs)
    this.messageBus.onNotification(
      onyvoreRpcMethods.NOTEBOOK_READY,
      () => this.recheckActiveEditor(),
    );
  }

  onModuleDestroy(): void {
    this.statusBarItem?.dispose();
    this.disposable?.dispose();
  }

  getActiveNotebookId(): string | null {
    return this.activeNotebookId;
  }

  getActiveNotePath(): string | null {
    return this.activeNotePath;
  }

  recheckActiveEditor(): void {
    const editor = this.vscode.window.activeTextEditor;
    this.onEditorChanged(editor ?? null);
  }

  private onEditorChanged(editor: any): void {
    // When editor loses focus (command palette, terminal, etc.), keep the last known state
    if (!editor) return;

    const filePath = editor.document.uri.fsPath;

    // Only update when a markdown file is focused; ignore non-markdown files
    if (!filePath.endsWith('.md')) return;

    const notebook = this.notebookDiscovery.findNotebookForFile(filePath);
    if (!notebook) {
      this.setActive(null, null);
      return;
    }

    const relativePath = path.relative(notebook.rootPath, filePath);
    this.setActive(notebook.id, relativePath);
  }

  private setActive(notebookId: string | null, notePath: string | null): void {
    const changed =
      this.activeNotebookId !== notebookId ||
      this.activeNotePath !== notePath;

    this.activeNotebookId = notebookId;
    this.activeNotePath = notePath;

    if (changed) {
      this.updateStatusBar();
      this.notifyWebview();
    }
  }

  private updateStatusBar(): void {
    if (!this.statusBarItem) return;

    if (this.activeNotebookId) {
      const notebook = this.notebookDiscovery.getNotebook(
        this.activeNotebookId,
      );
      this.statusBarItem.text = `$(notebook) ${notebook?.name ?? 'Unknown'}`;
      this.statusBarItem.tooltip = `Onyvore: ${notebook?.rootPath ?? ''}`;
    } else {
      this.statusBarItem.text = '$(notebook) No Notebook';
      this.statusBarItem.tooltip = 'Onyvore: No active notebook';
    }
  }

  private notifyWebview(): void {
    this.messageBus.sendNotification(onyvoreRpcMethods.ACTIVE_NOTEBOOK_CHANGED, {
      notebookId: this.activeNotebookId,
      activeNotePath: this.activeNotePath,
    });
  }
}
