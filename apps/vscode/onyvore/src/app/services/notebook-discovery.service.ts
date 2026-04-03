import { Injectable, Inject, OnModuleInit, forwardRef } from '@nestjs/common';
import { VSCODE_API, VscodeApi } from '@onivoro/server-vscode';
import { MESSAGE_BUS, MessageBus } from '@onivoro/isomorphic-jsonrpc';
import { onyvoreRpcMethods } from '@onivoro/isomorphic-onyvore';
import { FileWatcherService } from './file-watcher.service';
import * as path from 'path';

export interface DiscoveredNotebook {
  id: string;
  rootPath: string;
  name: string;
  hasPersistedState: boolean;
}

@Injectable()
export class NotebookDiscoveryService implements OnModuleInit {
  private discoveredNotebooks = new Map<string, DiscoveredNotebook>();

  constructor(
    @Inject(VSCODE_API) private readonly vscode: VscodeApi,
    @Inject(MESSAGE_BUS) private readonly messageBus: MessageBus,
    @Inject(forwardRef(() => FileWatcherService))
    private readonly fileWatcher: FileWatcherService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.discoverNotebooks();
  }

  async discoverNotebooks(): Promise<DiscoveredNotebook[]> {
    const workspaceFolders = this.vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return [];

    const newlyDiscovered: DiscoveredNotebook[] = [];

    for (const folder of workspaceFolders) {
      const rootUri = folder.uri;
      // Search for .onyvore/metadata.json files (findFiles only matches files, not directories)
      const metadataUris = await this.vscode.workspace.findFiles(
        new this.vscode.RelativePattern(rootUri, '**/.onyvore/metadata.json'),
        '**/node_modules/**',
      );

      for (const metadataUri of metadataUris) {
        // metadata.json → .onyvore/ → notebook root
        const notebookRoot = path.dirname(path.dirname(metadataUri.fsPath));
        const notebookId = notebookRoot; // Use absolute path as ID

        if (this.discoveredNotebooks.has(notebookId)) continue;

        const notebook: DiscoveredNotebook = {
          id: notebookId,
          rootPath: notebookRoot,
          name: path.basename(notebookRoot),
          hasPersistedState: true, // .onyvore/ exists
        };

        this.discoveredNotebooks.set(notebookId, notebook);
        newlyDiscovered.push(notebook);

        // Register with stdio server
        await this.messageBus.sendRequest(
          onyvoreRpcMethods.NOTEBOOK_REGISTER,
          {
            notebookId: notebook.id,
            rootPath: notebook.rootPath,
            name: notebook.name,
          },
        );

        // Trigger reconciliation for existing notebooks
        await this.messageBus.sendRequest(
          onyvoreRpcMethods.NOTEBOOK_RECONCILE,
          { notebookId: notebook.id },
        );

        // Set up file watcher so edits trigger index updates
        this.fileWatcher.registerNotebook(notebook.id, notebook.rootPath);
      }
    }

    return newlyDiscovered;
  }

  async initializeNotebook(rootPath: string): Promise<DiscoveredNotebook> {
    const notebookId = rootPath;

    // Create .onyvore/ directory
    const onyvoreUri = this.vscode.Uri.file(path.join(rootPath, '.onyvore'));
    await this.vscode.workspace.fs.createDirectory(onyvoreUri);

    const notebook: DiscoveredNotebook = {
      id: notebookId,
      rootPath,
      name: path.basename(rootPath),
      hasPersistedState: false,
    };

    this.discoveredNotebooks.set(notebookId, notebook);

    // Register and initialize with stdio server
    await this.messageBus.sendRequest(onyvoreRpcMethods.NOTEBOOK_REGISTER, {
      notebookId: notebook.id,
      rootPath: notebook.rootPath,
      name: notebook.name,
    });

    await this.messageBus.sendRequest(onyvoreRpcMethods.NOTEBOOK_INITIALIZE, {
      notebookId: notebook.id,
    });

    // Set up file watcher so edits trigger index updates
    this.fileWatcher.registerNotebook(notebook.id, notebook.rootPath);

    return notebook;
  }

  getNotebook(notebookId: string): DiscoveredNotebook | undefined {
    return this.discoveredNotebooks.get(notebookId);
  }

  getAllNotebooks(): DiscoveredNotebook[] {
    return Array.from(this.discoveredNotebooks.values());
  }

  findNotebookForFile(filePath: string): DiscoveredNotebook | undefined {
    let bestMatch: DiscoveredNotebook | undefined;
    let bestLength = 0;

    for (const notebook of this.discoveredNotebooks.values()) {
      // File must be under the notebook root
      if (
        filePath.startsWith(notebook.rootPath + path.sep) ||
        filePath === notebook.rootPath
      ) {
        // But NOT under a nested notebook
        const relPath = path.relative(notebook.rootPath, filePath);
        const segments = relPath.split(path.sep);

        // Check if any intermediate directory is a nested notebook
        let isNested = false;
        let checkPath = notebook.rootPath;
        for (let i = 0; i < segments.length - 1; i++) {
          checkPath = path.join(checkPath, segments[i]);
          if (
            this.discoveredNotebooks.has(checkPath) &&
            checkPath !== notebook.rootPath
          ) {
            isNested = true;
            break;
          }
        }

        if (!isNested && notebook.rootPath.length > bestLength) {
          bestMatch = notebook;
          bestLength = notebook.rootPath.length;
        }
      }
    }

    return bestMatch;
  }
}
