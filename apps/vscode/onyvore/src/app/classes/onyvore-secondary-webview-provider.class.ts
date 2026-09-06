import * as vscode from 'vscode';
import {
  BaseWebviewProvider,
  generateVscodeThemeBridgeInjection,
} from '@onivoro/server-vscode';

/**
 * A webview view other than the main sidebar.
 *
 * Every view renders the same bundle, distinguished by an injected flag, so one
 * React build serves all of them. Giving the Links and Graph panels their own
 * views lets VS Code collapse, reorder, and move them to the secondary sidebar,
 * rather than stacking everything in one scrolling column.
 */
export class OnyvoreSecondaryWebviewProvider extends BaseWebviewProvider {
  constructor(
    extensionUri: vscode.Uri,
    private readonly viewName: string,
  ) {
    super(extensionUri, {
      webviewDistPath: 'webview',
      enableCacheBusting: true,
      allowUnsafeInlineStyles: true,
    });
  }

  protected override getInjectedScripts(nonce: string): string {
    return `${generateVscodeThemeBridgeInjection(nonce)}
<script nonce="${nonce}">window.__ONYVORE_VIEW__ = ${JSON.stringify(this.viewName)};</script>`;
  }

  protected override getHtmlForWebview(webview: vscode.Webview): string {
    // Allow the base64-inlined codicon font via data: URI
    return super.getHtmlForWebview(webview).replace('font-src ', 'font-src data: ');
  }
}
