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
  private viewedNotebookId: string | null = null;
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

  /** The notebook shown in the sidebar, which the user selects explicitly. */
  getViewedNotebookId(): string | null {
    return this.viewedNotebookId;
  }

  setViewedNotebookId(notebookId: string | null): void {
    this.viewedNotebookId = notebookId;
  }

  /**
   * The notebook a sidebar action should target: the one on screen, falling
   * back to the one the editor is in.
   */
  getTargetNotebookId(): string | null {
    return this.viewedNotebookId ?? this.activeNotebookId;
  }

  recheckActiveEditor(): void {
    const editor = this.vscode.window.activeTextEditor;
    this.onEditorChanged(editor ?? null);
  }

  private onEditorChanged(editor: any): void {
    // Losing focus entirely (command palette, terminal, sidebar) is not a
    // change of note — keep the last known state so the panel does not blank
    // out while the user runs a command.
    if (!editor) return;

    const filePath = editor.document.uri.fsPath;

    // Focusing a different, non-note document *is* a change: the panel has no
    // links to show for it and must say so rather than keep stale ones.
    if (!filePath.endsWith('.md')) {
      this.setActive(null, null);
      return;
    }

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
