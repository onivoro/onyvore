import * as vscode from 'vscode';
import {
  BaseWebviewProvider,
  generateVscodeThemeBridgeInjection,
} from '@onivoro/server-vscode';

/**
 * The Links panel, registered as its own view.
 *
 * It renders the same webview bundle as the sidebar, distinguished by an
 * injected flag. Giving it a separate view lets VS Code collapse, reorder, and
 * move it to the secondary sidebar — which is where a backlinks panel belongs
 * while writing, rather than below the fold of a single scrolling column.
 */
export class OnyvoreLinksWebviewProvider extends BaseWebviewProvider {
  public static readonly viewType = 'onyvore.links';

  constructor(extensionUri: vscode.Uri) {
    super(extensionUri, {
      webviewDistPath: 'webview',
      enableCacheBusting: true,
      allowUnsafeInlineStyles: true,
    });
  }

  protected override getInjectedScripts(nonce: string): string {
    return `${generateVscodeThemeBridgeInjection(nonce)}
<script nonce="${nonce}">window.__ONYVORE_VIEW__ = 'links';</script>`;
  }

  protected override getHtmlForWebview(webview: vscode.Webview): string {
    // Allow the base64-inlined codicon font via data: URI
    return super.getHtmlForWebview(webview).replace('font-src ', 'font-src data: ');
  }
}
