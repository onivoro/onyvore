import { Injectable, Inject } from '@nestjs/common';
import {
  CommandHandler,
  BaseWebviewProvider,
  WEBVIEW_PROVIDER,
  VSCODE_API,
  VscodeApi,
} from '@onivoro/server-vscode';
import { MESSAGE_BUS, MessageBus } from '@onivoro/isomorphic-jsonrpc';
import { onyvoreCommands, onyvoreRpcMethods } from '@onivoro/isomorphic-onyvore';
import { NotebookDiscoveryService } from './notebook-discovery.service';
import { ActiveNotebookService } from './active-notebook.service';
import { FileWatcherService } from './file-watcher.service';

@Injectable()
export class OnyvoreCommandHandlerService {
  constructor(
    @Inject(VSCODE_API) private readonly vscode: VscodeApi,
    @Inject(MESSAGE_BUS) private readonly messageBus: MessageBus,
    @Inject(WEBVIEW_PROVIDER) private readonly webviewProvider: BaseWebviewProvider,
    private readonly notebookDiscovery: NotebookDiscoveryService,
    private readonly activeNotebook: ActiveNotebookService,
    private readonly fileWatcher: FileWatcherService,
  ) {}

  @CommandHandler(onyvoreCommands.INITIALIZE_NOTEBOOK)
  async initializeNotebook(): Promise<void> {
    const uris = await this.vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: false,
      openLabel: 'Initialize Notebook Here',
    });

    if (!uris || uris.length === 0) return;

    const rootPath = uris[0].fsPath;
    const notebook = await this.notebookDiscovery.initializeNotebook(rootPath);

    // Set up file watcher for the new notebook
    this.fileWatcher.registerNotebook(notebook.id, notebook.rootPath);

    await this.vscode.window.showInformationMessage(
      `Onyvore notebook initialized: ${notebook.name}`,
    );
  }

  @CommandHandler(onyvoreCommands.DISCOVER_NOTEBOOKS)
  async discoverNotebooks(): Promise<void> {
    const discovered = await this.notebookDiscovery.discoverNotebooks();

    // Register file watchers for any newly discovered notebooks
    for (const notebook of discovered) {
      this.fileWatcher.registerNotebook(notebook.id, notebook.rootPath);
    }

    const count = discovered.length;
    await this.vscode.window.showInformationMessage(
      count > 0
        ? `Discovered ${count} new notebook${count > 1 ? 's' : ''}`
        : 'No new notebooks found',
    );
  }

  @CommandHandler(onyvoreCommands.SEARCH_NOTEBOOK)
  async searchNotebook(): Promise<void> {
    const notebookId = this.activeNotebook.getActiveNotebookId();
    if (!notebookId) {
      await this.vscode.window.showWarningMessage(
        'No active notebook. Open a file within a notebook first.',
      );
      return;
    }

    // Signal the webview to show the search overlay
    this.messageBus.sendNotification(onyvoreRpcMethods.SEARCH_SHOW, { notebookId });
  }

  @CommandHandler(onyvoreCommands.REBUILD_NOTEBOOK)
  async rebuildNotebook(): Promise<void> {
    const notebookId = this.activeNotebook.getActiveNotebookId();
    if (!notebookId) {
      await this.vscode.window.showWarningMessage(
        'No active notebook. Open a file within a notebook first.',
      );
      return;
    }

    const notebook = this.notebookDiscovery.getNotebook(notebookId);
    const confirm = await this.vscode.window.showWarningMessage(
      `Rebuild notebook "${notebook?.name}"? This will delete all derived artifacts and re-index from scratch.`,
      'Rebuild',
      'Cancel',
    );

    if (confirm !== 'Rebuild') return;

    await this.messageBus.sendRequest(onyvoreRpcMethods.NOTEBOOK_REBUILD, {
      notebookId,
    });

    await this.vscode.window.showInformationMessage(
      'Notebook rebuild started. Search and links will update progressively.',
    );
  }
}
