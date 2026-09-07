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
      // A notebook is any directory containing .onyvore/, so match anything
      // inside one rather than a single artifact — derived files come and go
      // (Rebuild deletes them all), but the directory is what defines the
      // notebook. findFiles matches files only, hence the trailing `/**`.
      const marked = await this.vscode.workspace.findFiles(
        new this.vscode.RelativePattern(rootUri, '**/.onyvore/**'),
        '**/node_modules/**',
      );

      const roots = new Set<string>();
      for (const uri of marked) {
        const root = this.notebookRootFor(uri.fsPath);
        if (root) roots.add(root);
      }

      for (const notebookRoot of roots) {
        const notebookId = notebookRoot; // Use absolute path as ID

        if (this.discoveredNotebooks.has(notebookId)) continue;

        // Backfill the marker for notebooks created before it existed, so a
        // later Rebuild cannot make the notebook undiscoverable.
        await this.writeMarker(notebookRoot);

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

    // Create .onyvore/ and its marker file
    const onyvoreUri = this.vscode.Uri.file(path.join(rootPath, '.onyvore'));
    await this.vscode.workspace.fs.createDirectory(onyvoreUri);
    await this.writeMarker(rootPath);

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

  /**
   * Resolve the notebook root from any path inside its `.onyvore/` directory.
   * Returns null when the path is not inside one.
   */
  private notebookRootFor(fsPath: string): string | null {
    const segments = fsPath.split(path.sep);
    const index = segments.indexOf('.onyvore');
    if (index <= 0) return null;
    return segments.slice(0, index).join(path.sep);
  }

  /**
   * Write `.onyvore/notebook.json`. This is the one file in `.onyvore/` that is
   * not derived — it marks the directory as a notebook and survives Rebuild.
   */
  private async writeMarker(rootPath: string): Promise<void> {
    const markerUri = this.vscode.Uri.file(
      path.join(rootPath, '.onyvore', 'notebook.json'),
    );
    try {
      await this.vscode.workspace.fs.stat(markerUri);
      return; // Already present.
    } catch {
      // Not there yet — write it below.
    }

    try {
      await this.vscode.workspace.fs.writeFile(
        markerUri,
        Buffer.from(JSON.stringify({ version: 1 }, null, 2)),
      );
    } catch {
      // A read-only notebook still works; discovery just falls back to
      // whichever derived artifacts happen to be present.
    }
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
