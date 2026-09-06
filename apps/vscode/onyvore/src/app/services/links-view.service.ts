import { Injectable, Inject, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import {
  VSCODE_API,
  VscodeApi,
  STDIO_SERVER_PROCESS,
  defaultWebviewMessageHandler,
} from '@onivoro/server-vscode';
import { MESSAGE_BUS, MessageBus } from '@onivoro/isomorphic-jsonrpc';
import { onyvoreRpcMethods } from '@onivoro/isomorphic-onyvore';
import { OnyvoreLinksWebviewProvider } from '../classes/onyvore-links-webview-provider.class';

/**
 * Hosts the Links panel as a second webview view.
 *
 * The extension framework wires exactly one webview, so this registers the
 * additional view itself: requests go through the same
 * `defaultWebviewMessageHandler` the primary view uses, and the notifications
 * the panel depends on are forwarded explicitly, since the framework's
 * broadcast only reaches the primary provider.
 */
@Injectable()
export class LinksViewService implements OnModuleInit, OnModuleDestroy {
  private provider: OnyvoreLinksWebviewProvider | null = null;
  private disposables: any[] = [];

  constructor(
    @Inject(VSCODE_API) private readonly vscode: VscodeApi,
    @Inject(MESSAGE_BUS) private readonly messageBus: MessageBus,
    @Inject(STDIO_SERVER_PROCESS) private readonly serverProcess: any,
  ) {}

  onModuleInit(): void {
    const vs = this.vscode as any;
    const extensionUri = this.vscode.Uri.file(__dirname);

    this.provider = new OnyvoreLinksWebviewProvider(extensionUri);

    this.provider.onMessage((message: any) =>
      defaultWebviewMessageHandler(message, {
        serverProcess: this.serverProcess,
        webviewProvider: this.provider!,
      }),
    );

    this.disposables.push(
      vs.window.registerWebviewViewProvider(
        OnyvoreLinksWebviewProvider.viewType,
        this.provider,
      ),
    );

    // Only the notifications this panel reacts to; the rest belong to the
    // sidebar and would be noise here.
    for (const method of [
      onyvoreRpcMethods.ACTIVE_NOTEBOOK_CHANGED,
      onyvoreRpcMethods.NOTEBOOK_INDEX_UPDATED,
      onyvoreRpcMethods.NOTEBOOK_READY,
    ]) {
      this.messageBus.onNotification(method, (params: unknown) => {
        this.provider?.postMessage({ jsonrpc: '2.0', method, params });
      });
    }
  }

  onModuleDestroy(): void {
    for (const disposable of this.disposables) disposable?.dispose();
    this.disposables = [];
    this.provider = null;
  }
}
