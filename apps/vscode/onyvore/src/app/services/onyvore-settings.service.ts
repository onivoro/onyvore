import { Injectable, Inject, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { VSCODE_API, VscodeApi } from '@onivoro/server-vscode';
import { MESSAGE_BUS, MessageBus } from '@onivoro/isomorphic-jsonrpc';
import { onyvoreRpcMethods } from '@onivoro/isomorphic-onyvore';

const SECTION = 'onyvore';

/**
 * Reads `onyvore.*` settings and keeps both processes in step.
 *
 * Settings that shape the link graph live in the stdio server, so they are
 * pushed there on activation and whenever the user changes them; settings that
 * only affect the extension host are read directly.
 */
@Injectable()
export class OnyvoreSettingsService implements OnModuleInit, OnModuleDestroy {
  private disposable: any = null;

  constructor(
    @Inject(VSCODE_API) private readonly vscode: VscodeApi,
    @Inject(MESSAGE_BUS) private readonly messageBus: MessageBus,
  ) {}

  onModuleInit(): void {
    void this.push();

    this.disposable = (this.vscode as any).workspace.onDidChangeConfiguration(
      (event: any) => {
        if (event.affectsConfiguration(SECTION)) void this.push();
      },
    );
  }

  onModuleDestroy(): void {
    this.disposable?.dispose();
  }

  get debounceMs(): number {
    return this.read('fileWatcher.debounceMs', 300);
  }

  get showUnresolvedWikilinks(): boolean {
    return this.read('wikilinks.showUnresolved', true);
  }

  private async push(): Promise<void> {
    try {
      await this.messageBus.sendRequest(onyvoreRpcMethods.SERVER_CONFIGURE, {
        similarityEnabled: this.read('relatedNotes.enabled', true),
        similarityThreshold: this.read('relatedNotes.threshold', 0.15),
        maxSimilarPerNote: this.read('relatedNotes.maxPerNote', 10),
      });
    } catch {
      // Server not up yet; activation pushes again once it is.
    }
  }

  private read<T>(key: string, fallback: T): T {
    const value = this.vscode.workspace.getConfiguration(SECTION).get<T>(key);
    return value === undefined || value === null ? fallback : value;
  }
}
