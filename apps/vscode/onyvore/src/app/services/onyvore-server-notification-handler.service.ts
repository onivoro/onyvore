import { Injectable, Inject } from '@nestjs/common';
import { ServerNotificationHandler, VSCODE_API, VscodeApi } from '@onivoro/server-vscode';
import { onyvoreRpcMethods } from '@onivoro/isomorphic-onyvore';

@Injectable()
export class OnyvoreServerNotificationHandlerService {
  constructor(@Inject(VSCODE_API) private readonly vscode: VscodeApi) {}

  @ServerNotificationHandler(onyvoreRpcMethods.NOTEBOOK_INIT_PROGRESS)
  handleInitProgress(params: {
    notebookId: string;
    processed: number;
    total: number;
    progress: number;
  }): void {
    this.vscode.window.setStatusBarMessage(
      `Onyvore: Initializing... ${params.progress}% (${params.processed}/${params.total})`,
      3000,
    );
  }

  @ServerNotificationHandler(onyvoreRpcMethods.NOTEBOOK_RECONCILE_PROGRESS)
  handleReconcileProgress(params: {
    notebookId: string;
    processed: number;
    total: number;
    progress: number;
  }): void {
    this.vscode.window.setStatusBarMessage(
      `Onyvore: Reconciling... ${params.progress}% (${params.processed}/${params.total})`,
      3000,
    );
  }

  @ServerNotificationHandler(onyvoreRpcMethods.NOTEBOOK_READY)
  handleNotebookReady(params: { notebookId: string }): void {
    this.vscode.window.setStatusBarMessage('Onyvore: Notebook ready', 3000);
  }

  @ServerNotificationHandler(onyvoreRpcMethods.NOTEBOOK_INDEX_UPDATED)
  handleIndexUpdated(params: { notebookId: string }): void {
    // Notification is auto-broadcast to webview by the framework.
    // This handler allows for extension-host-side reactions if needed.
  }
}
