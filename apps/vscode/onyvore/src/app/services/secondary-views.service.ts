import { Injectable, Inject, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import {
  VSCODE_API,
  VscodeApi,
  STDIO_SERVER_PROCESS,
  defaultWebviewMessageHandler,
} from '@onivoro/server-vscode';
import { MESSAGE_BUS, MessageBus } from '@onivoro/isomorphic-jsonrpc';
import { onyvoreRpcMethods } from '@onivoro/isomorphic-onyvore';
import { OnyvoreSecondaryWebviewProvider } from '../classes/onyvore-secondary-webview-provider.class';

/** View id → the flag the webview bundle reads to pick what to render. */
const VIEWS: Array<{ viewType: string; name: string }> = [
  { viewType: 'onyvore.links', name: 'links' },
  { viewType: 'onyvore.graph', name: 'graph' },
];

/** Notifications these panels react to. The rest belong to the sidebar. */
const FORWARDED = [
  onyvoreRpcMethods.ACTIVE_NOTEBOOK_CHANGED,
  onyvoreRpcMethods.NOTEBOOK_INDEX_UPDATED,
  onyvoreRpcMethods.NOTEBOOK_READY,
];

/**
 * Hosts the webview views beyond the main sidebar.
 *
 * The extension framework wires exactly one webview provider, so these are
 * registered here: requests go through the same `defaultWebviewMessageHandler`
 * the primary view uses, and the notifications they need are forwarded
 * explicitly, since the framework's broadcast reaches only the primary.
 */
@Injectable()
export class SecondaryViewsService implements OnModuleInit, OnModuleDestroy {
  private providers: OnyvoreSecondaryWebviewProvider[] = [];
  private disposables: any[] = [];

  constructor(
    @Inject(VSCODE_API) private readonly vscode: VscodeApi,
    @Inject(MESSAGE_BUS) private readonly messageBus: MessageBus,
    @Inject(STDIO_SERVER_PROCESS) private readonly serverProcess: any,
  ) {}

  onModuleInit(): void {
    const vs = this.vscode as any;
    const extensionUri = this.vscode.Uri.file(__dirname);

    for (const { viewType, name } of VIEWS) {
      const provider = new OnyvoreSecondaryWebviewProvider(extensionUri, name);

      provider.onMessage((message: any) =>
        defaultWebviewMessageHandler(message, {
          serverProcess: this.serverProcess,
          webviewProvider: provider,
        }),
      );

      this.disposables.push(
        vs.window.registerWebviewViewProvider(viewType, provider),
      );
      this.providers.push(provider);
    }

    for (const method of FORWARDED) {
      this.messageBus.onNotification(method, (params: unknown) => {
        for (const provider of this.providers) {
          provider.postMessage({ jsonrpc: '2.0', method, params });
        }
      });
    }
  }

  onModuleDestroy(): void {
    for (const disposable of this.disposables) disposable?.dispose();
    this.disposables = [];
    this.providers = [];
  }
}
