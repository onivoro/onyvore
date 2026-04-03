import { Injectable, Inject, OnModuleDestroy, forwardRef } from '@nestjs/common';
import { VSCODE_API, VscodeApi } from '@onivoro/server-vscode';
import { MESSAGE_BUS, MessageBus } from '@onivoro/isomorphic-jsonrpc';
import { onyvoreRpcMethods, type FileEvent } from '@onivoro/isomorphic-onyvore';
import { NotebookDiscoveryService } from './notebook-discovery.service';
import * as path from 'path';
import * as fs from 'fs';
import ignore from 'ignore';

const DEBOUNCE_MS = 300;

interface WatcherState {
  watcher: any; // vscode.FileSystemWatcher
  ignoreWatcher: any; // vscode.FileSystemWatcher for .onyvoreignore
  pending: Map<string, FileEvent>;
  timer: NodeJS.Timeout | null;
  ignoreFilter: ReturnType<typeof ignore> | null;
}

@Injectable()
export class FileWatcherService implements OnModuleDestroy {
  private watchers = new Map<string, WatcherState>();

  constructor(
    @Inject(VSCODE_API) private readonly vscode: VscodeApi,
    @Inject(MESSAGE_BUS) private readonly messageBus: MessageBus,
    @Inject(forwardRef(() => NotebookDiscoveryService))
    private readonly notebookDiscovery: NotebookDiscoveryService,
  ) {}

  onModuleDestroy(): void {
    for (const [, state] of this.watchers) {
      state.watcher?.dispose();
      state.ignoreWatcher?.dispose();
      if (state.timer) clearTimeout(state.timer);
    }
    this.watchers.clear();
  }

  registerNotebook(notebookId: string, rootPath: string): void {
    if (this.watchers.has(notebookId)) return;

    const pattern = new this.vscode.RelativePattern(rootPath, '**/*.md');
    const watcher = this.vscode.workspace.createFileSystemWatcher(pattern);

    const state: WatcherState = {
      watcher,
      ignoreWatcher: null,
      pending: new Map(),
      timer: null,
      ignoreFilter: null,
    };

    // Load .onyvoreignore if it exists
    this.loadIgnoreFile(rootPath, state);

    // Watch .onyvoreignore for changes
    const ignorePattern = new this.vscode.RelativePattern(
      rootPath,
      '.onyvoreignore',
    );
    state.ignoreWatcher = this.vscode.workspace.createFileSystemWatcher(ignorePattern);
    state.ignoreWatcher.onDidChange(() => this.onIgnoreChanged(notebookId, rootPath, state));
    state.ignoreWatcher.onDidCreate(() => this.onIgnoreChanged(notebookId, rootPath, state));
    state.ignoreWatcher.onDidDelete(() => this.onIgnoreChanged(notebookId, rootPath, state));

    // Register file event handlers
    watcher.onDidCreate((uri: any) =>
      this.onFileEvent(notebookId, rootPath, uri.fsPath, 'create', state),
    );
    watcher.onDidChange((uri: any) =>
      this.onFileEvent(notebookId, rootPath, uri.fsPath, 'change', state),
    );
    watcher.onDidDelete((uri: any) =>
      this.onFileEvent(notebookId, rootPath, uri.fsPath, 'delete', state),
    );

    this.watchers.set(notebookId, state);
  }

  unregisterNotebook(notebookId: string): void {
    const state = this.watchers.get(notebookId);
    if (!state) return;
    state.watcher?.dispose();
    state.ignoreWatcher?.dispose();
    if (state.timer) clearTimeout(state.timer);
    this.watchers.delete(notebookId);
  }

  private onFileEvent(
    notebookId: string,
    rootPath: string,
    filePath: string,
    type: FileEvent['type'],
    state: WatcherState,
  ): void {
    const relativePath = path.relative(rootPath, filePath);

    // Exclude files inside nested notebooks
    if (this.isInsideNestedNotebook(notebookId, filePath)) return;

    // Exclude files matching .onyvoreignore patterns
    if (state.ignoreFilter && state.ignoreFilter.ignores(relativePath)) return;

    // Skip .onyvore directory contents
    if (relativePath.startsWith('.onyvore' + path.sep)) return;

    const event: FileEvent = { type, relativePath, notebookId };
    state.pending.set(relativePath, event);

    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      const batch: FileEvent[] = Array.from(state.pending.values());
      state.pending.clear();
      this.messageBus.sendRequest(onyvoreRpcMethods.NOTEBOOK_FILE_EVENT, {
        notebookId,
        events: batch,
      });
    }, DEBOUNCE_MS);
  }

  private isInsideNestedNotebook(
    notebookId: string,
    filePath: string,
  ): boolean {
    for (const notebook of this.notebookDiscovery.getAllNotebooks()) {
      if (notebook.id === notebookId) continue;
      if (
        filePath.startsWith(notebook.rootPath + path.sep) &&
        notebook.rootPath.startsWith(notebookId + path.sep)
      ) {
        return true; // File is inside a nested notebook
      }
    }
    return false;
  }

  private loadIgnoreFile(rootPath: string, state: WatcherState): void {
    const ignorePath = path.join(rootPath, '.onyvoreignore');
    try {
      const content = fs.readFileSync(ignorePath, 'utf-8');
      state.ignoreFilter = ignore().add(content);
    } catch {
      state.ignoreFilter = null;
    }
  }

  private async onIgnoreChanged(
    notebookId: string,
    rootPath: string,
    state: WatcherState,
  ): Promise<void> {
    this.loadIgnoreFile(rootPath, state);

    // Determine which files changed status by comparing old and new filters
    // For simplicity, send ignoreChanged to the server which does a full re-evaluation
    await this.messageBus.sendRequest(
      onyvoreRpcMethods.NOTEBOOK_IGNORE_CHANGED,
      {
        notebookId,
        ignoredPaths: [],
        includedPaths: [],
      },
    );
  }
}
