import { Injectable, Inject, OnModuleInit } from '@nestjs/common';
import { MESSAGE_BUS, MessageBus } from '@onivoro/isomorphic-jsonrpc';
import { onyvoreRpcMethods } from '@onivoro/isomorphic-onyvore';

interface NotebookListResponse {
  notebooks: Array<{
    id: string;
    files: Array<{ relativePath: string }>;
  }>;
}

/**
 * Caches each notebook's file list in the extension host.
 *
 * The editor features — completion, link resolution, hover, diagnostics — need
 * the file list synchronously and often (on every keystroke, for every visible
 * document). Round-tripping to the stdio server for each would be far too
 * chatty, so the list is cached and refreshed whenever the server says the
 * index changed.
 */
@Injectable()
export class NotebookFilesService implements OnModuleInit {
  private files = new Map<string, string[]>();

  constructor(@Inject(MESSAGE_BUS) private readonly messageBus: MessageBus) {}

  onModuleInit(): void {
    for (const method of [
      onyvoreRpcMethods.NOTEBOOK_READY,
      onyvoreRpcMethods.NOTEBOOK_INDEX_UPDATED,
    ]) {
      this.messageBus.onNotification(method, () => {
        void this.refresh();
      });
    }

    void this.refresh();
  }

  getFiles(notebookId: string): string[] {
    return this.files.get(notebookId) ?? [];
  }

  async refresh(): Promise<void> {
    try {
      const response = (await this.messageBus.sendRequest(
        onyvoreRpcMethods.NOTEBOOK_GET_NOTEBOOKS,
        {},
      )) as NotebookListResponse | undefined;

      if (!response?.notebooks) return;

      this.files.clear();
      for (const notebook of response.notebooks) {
        this.files.set(
          notebook.id,
          notebook.files.map((f) => f.relativePath),
        );
      }
    } catch {
      // Server not ready yet; the next notification refreshes.
    }
  }
}
