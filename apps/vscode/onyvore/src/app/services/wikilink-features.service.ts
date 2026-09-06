import { Injectable, Inject, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { VSCODE_API, VscodeApi } from '@onivoro/server-vscode';
import {
  parseWikilinks,
  resolveWikilinkTarget,
  wikilinkCompletionFor,
  noteBasename,
} from '@onivoro/isomorphic-onyvore';
import { NotebookDiscoveryService } from './notebook-discovery.service';
import { NotebookFilesService } from './notebook-files.service';
import * as path from 'path';

const MARKDOWN = { language: 'markdown', scheme: 'file' };
const HOVER_PREVIEW_CHARS = 400;

/**
 * Editor support for `[[wikilinks]]`: completion, ctrl-click navigation, and
 * hover previews.
 *
 * Resolution comes from the shared isomorphic helpers, the same ones the stdio
 * server uses to build the link graph — so where the editor navigates and where
 * the graph drew an edge cannot disagree.
 */
@Injectable()
export class WikilinkFeaturesService implements OnModuleInit, OnModuleDestroy {
  private disposables: any[] = [];

  constructor(
    @Inject(VSCODE_API) private readonly vscode: VscodeApi,
    private readonly notebookDiscovery: NotebookDiscoveryService,
    private readonly notebookFiles: NotebookFilesService,
  ) {}

  onModuleInit(): void {
    const languages = (this.vscode as any).languages;

    this.disposables.push(
      languages.registerCompletionItemProvider(
        MARKDOWN,
        { provideCompletionItems: (doc: any, pos: any) => this.complete(doc, pos) },
        '[',
      ),
      languages.registerDocumentLinkProvider(MARKDOWN, {
        provideDocumentLinks: (doc: any) => this.documentLinks(doc),
      }),
      languages.registerHoverProvider(MARKDOWN, {
        provideHover: (doc: any, pos: any) => this.hover(doc, pos),
      }),
    );
  }

  onModuleDestroy(): void {
    for (const disposable of this.disposables) disposable?.dispose();
    this.disposables = [];
  }

  /** The notebook owning a document, plus its file list. */
  private contextFor(doc: any): { rootPath: string; files: string[] } | null {
    const notebook = this.notebookDiscovery.findNotebookForFile(doc.uri.fsPath);
    if (!notebook) return null;
    return {
      rootPath: notebook.rootPath,
      files: this.notebookFiles.getFiles(notebook.id),
    };
  }

  // ---- completion ----------------------------------------------------------

  private complete(doc: any, position: any): any[] {
    const context = this.contextFor(doc);
    if (!context) return [];

    const prefix = this.openWikilinkPrefix(doc, position);
    if (prefix === null) return [];

    const currentFile = path.relative(context.rootPath, doc.uri.fsPath);
    const replaceRange = new (this.vscode as any).Range(
      position.translate(0, -prefix.length),
      position,
    );

    return context.files
      .filter((file) => file !== currentFile) // a note cannot link to itself
      .map((file) => {
        const insertText = wikilinkCompletionFor(file, context.files);
        const item = new (this.vscode as any).CompletionItem(
          insertText,
          (this.vscode as any).CompletionItemKind.File,
        );
        item.detail = file;
        item.insertText = insertText;
        item.range = replaceRange;
        // Sort root-level notes first; they are the more likely referent.
        item.sortText = `${String(file.split(/[\\/]/).length).padStart(3, '0')}${insertText}`;
        return item;
      });
  }

  /**
   * Text typed after an unclosed `[[` on the cursor's line, or null when the
   * cursor is not inside a wikilink.
   */
  private openWikilinkPrefix(doc: any, position: any): string | null {
    const line: string = doc.lineAt(position.line).text;
    const before = line.slice(0, position.character);

    const open = before.lastIndexOf('[[');
    if (open === -1) return null;

    const between = before.slice(open + 2);
    // Already closed, or spilling past the link — not a completion context.
    if (between.includes(']]') || between.includes('[')) return null;

    return between;
  }

  // ---- document links ------------------------------------------------------

  private documentLinks(doc: any): any[] {
    const context = this.contextFor(doc);
    if (!context) return [];

    const content: string = doc.getText();
    const links: any[] = [];

    for (const link of parseWikilinks(content)) {
      const resolved = resolveWikilinkTarget(link.target, context.files);
      if (!resolved) continue; // unresolved links are reported as diagnostics

      const range = new (this.vscode as any).Range(
        doc.positionAt(link.start),
        doc.positionAt(link.end),
      );
      const documentLink = new (this.vscode as any).DocumentLink(
        range,
        this.vscode.Uri.file(path.join(context.rootPath, resolved)),
      );
      documentLink.tooltip = resolved;
      links.push(documentLink);
    }

    return links;
  }

  // ---- hover ---------------------------------------------------------------

  private async hover(doc: any, position: any): Promise<any> {
    const context = this.contextFor(doc);
    if (!context) return undefined;

    const offset: number = doc.offsetAt(position);
    const link = parseWikilinks(doc.getText()).find(
      (l) => offset >= l.start && offset <= l.end,
    );
    if (!link) return undefined;

    const range = new (this.vscode as any).Range(
      doc.positionAt(link.start),
      doc.positionAt(link.end),
    );

    const resolved = resolveWikilinkTarget(link.target, context.files);
    const markdown = new (this.vscode as any).MarkdownString();

    if (!resolved) {
      markdown.appendMarkdown(
        `**Unresolved link** — no note named \`${link.target}\` in this notebook.`,
      );
      return new (this.vscode as any).Hover(markdown, range);
    }

    markdown.appendMarkdown(`**${noteBasename(resolved)}** — \`${resolved}\`\n\n`);
    markdown.appendMarkdown(await this.preview(context.rootPath, resolved));

    return new (this.vscode as any).Hover(markdown, range);
  }

  private async preview(rootPath: string, relativePath: string): Promise<string> {
    try {
      const uri = this.vscode.Uri.file(path.join(rootPath, relativePath));
      const doc = await this.vscode.workspace.openTextDocument(uri);
      const text: string = doc.getText().trim();
      if (!text) return '_Empty note._';
      return text.length > HOVER_PREVIEW_CHARS
        ? `${text.slice(0, HOVER_PREVIEW_CHARS)}…`
        : text;
    } catch {
      return '_Could not read note._';
    }
  }
}
