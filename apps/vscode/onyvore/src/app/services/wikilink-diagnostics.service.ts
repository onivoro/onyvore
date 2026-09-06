import { Injectable, Inject, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { VSCODE_API, VscodeApi } from '@onivoro/server-vscode';
import { MESSAGE_BUS, MessageBus } from '@onivoro/isomorphic-jsonrpc';
import {
  onyvoreRpcMethods,
  parseWikilinks,
  resolveWikilinkTarget,
  noteBasename,
} from '@onivoro/isomorphic-onyvore';
import { NotebookDiscoveryService } from './notebook-discovery.service';
import { NotebookFilesService } from './notebook-files.service';
import { OnyvoreSettingsService } from './onyvore-settings.service';
import * as path from 'path';

const MARKDOWN = { language: 'markdown', scheme: 'file' };
const UNRESOLVED = 'onyvore.unresolvedWikilink';
const MAX_SUGGESTIONS = 3;

/**
 * Reports wikilinks that resolve to nothing, and offers fixes.
 *
 * Onyvore never rewrites user files, so a link broken by a rename cannot be
 * silently repaired the way Obsidian repairs one. Surfacing it instead is what
 * makes that guarantee safe rather than lossy: the problem is visible in the
 * Problems panel, and the quick fix applies the edit as the user's action.
 */
@Injectable()
export class WikilinkDiagnosticsService implements OnModuleInit, OnModuleDestroy {
  private collection: any = null;
  private disposables: any[] = [];

  constructor(
    @Inject(VSCODE_API) private readonly vscode: VscodeApi,
    @Inject(MESSAGE_BUS) private readonly messageBus: MessageBus,
    private readonly notebookDiscovery: NotebookDiscoveryService,
    private readonly notebookFiles: NotebookFilesService,
    private readonly settings: OnyvoreSettingsService,
  ) {}

  onModuleInit(): void {
    const vs = this.vscode as any;
    this.collection = vs.languages.createDiagnosticCollection('onyvore');

    this.disposables.push(
      this.collection,
      vs.workspace.onDidOpenTextDocument((doc: any) => this.refresh(doc)),
      vs.workspace.onDidChangeTextDocument((event: any) => this.refresh(event.document)),
      vs.workspace.onDidCloseTextDocument((doc: any) => this.collection.delete(doc.uri)),
      vs.languages.registerCodeActionsProvider(
        MARKDOWN,
        { provideCodeActions: (doc: any, _r: any, ctx: any) => this.codeActions(doc, ctx) },
        { providedCodeActionKinds: [vs.CodeActionKind.QuickFix] },
      ),
    );

    // A note appearing elsewhere can resolve links that were broken before.
    this.messageBus.onNotification(onyvoreRpcMethods.NOTEBOOK_INDEX_UPDATED, () => {
      this.refreshAllOpen();
    });

    this.disposables.push(
      vs.workspace.onDidChangeConfiguration((event: any) => {
        if (event.affectsConfiguration('onyvore.wikilinks')) this.refreshAllOpen();
      }),
    );

    this.refreshAllOpen();
  }

  onModuleDestroy(): void {
    for (const disposable of this.disposables) disposable?.dispose();
    this.disposables = [];
    this.collection = null;
  }

  private refreshAllOpen(): void {
    for (const doc of this.vscode.workspace.textDocuments ?? []) {
      this.refresh(doc);
    }
  }

  private refresh(doc: any): void {
    if (!this.collection) return;
    if (doc?.languageId !== 'markdown' || doc.uri?.scheme !== 'file') return;

    if (!this.settings.showUnresolvedWikilinks) {
      this.collection.delete(doc.uri);
      return;
    }

    const notebook = this.notebookDiscovery.findNotebookForFile(doc.uri.fsPath);
    if (!notebook) {
      this.collection.delete(doc.uri);
      return;
    }

    const files = this.notebookFiles.getFiles(notebook.id);
    const vs = this.vscode as any;
    const diagnostics: any[] = [];

    for (const link of parseWikilinks(doc.getText())) {
      if (resolveWikilinkTarget(link.target, files)) continue;

      const diagnostic = new vs.Diagnostic(
        new vs.Range(doc.positionAt(link.start), doc.positionAt(link.end)),
        `No note named "${link.target}" in this notebook.`,
        vs.DiagnosticSeverity.Warning,
      );
      diagnostic.code = UNRESOLVED;
      diagnostic.source = 'Onyvore';
      diagnostics.push(diagnostic);
    }

    this.collection.set(doc.uri, diagnostics);
  }

  private codeActions(doc: any, context: any): any[] {
    const notebook = this.notebookDiscovery.findNotebookForFile(doc.uri.fsPath);
    if (!notebook) return [];

    const files = this.notebookFiles.getFiles(notebook.id);
    const actions: any[] = [];

    for (const diagnostic of context.diagnostics ?? []) {
      if (diagnostic.code !== UNRESOLVED) continue;

      const target = this.targetAt(doc, diagnostic.range);
      if (!target) continue;

      actions.push(this.createNoteAction(notebook.rootPath, target, diagnostic));
      actions.push(...this.repointActions(doc, target, files, diagnostic));
    }

    return actions;
  }

  private targetAt(doc: any, range: any): string | null {
    const offset: number = doc.offsetAt(range.start);
    const link = parseWikilinks(doc.getText()).find((l) => l.start === offset);
    return link?.target ?? null;
  }

  /** Create the missing note, seeded with its title. */
  private createNoteAction(rootPath: string, target: string, diagnostic: any): any {
    const vs = this.vscode as any;
    const relativePath = target.endsWith('.md') ? target : `${target}.md`;
    const uri = this.vscode.Uri.file(path.join(rootPath, relativePath));

    const action = new vs.CodeAction(
      `Create note "${relativePath}"`,
      vs.CodeActionKind.QuickFix,
    );
    action.diagnostics = [diagnostic];
    action.isPreferred = true;

    const edit = new vs.WorkspaceEdit();
    edit.createFile(uri, { ignoreIfExists: true });
    edit.insert(uri, new vs.Position(0, 0), `# ${noteBasename(relativePath)}\n\n`);
    action.edit = edit;

    return action;
  }

  /**
   * Offer existing notes with a similar name — the usual cause of a broken link
   * is a rename, so the intended target is normally still in the notebook.
   */
  private repointActions(
    doc: any,
    target: string,
    files: string[],
    diagnostic: any,
  ): any[] {
    const vs = this.vscode as any;
    const wanted = target.toLowerCase();

    const scored = files
      .map((file) => ({ file, name: noteBasename(file).toLowerCase() }))
      .filter(({ name }) => name.includes(wanted) || wanted.includes(name))
      .slice(0, MAX_SUGGESTIONS);

    return scored.map(({ file }) => {
      const replacement = noteBasename(file);
      const action = new vs.CodeAction(
        `Change link to "${replacement}"`,
        vs.CodeActionKind.QuickFix,
      );
      action.diagnostics = [diagnostic];

      const edit = new vs.WorkspaceEdit();
      edit.replace(doc.uri, diagnostic.range, `[[${replacement}]]`);
      action.edit = edit;

      return action;
    });
  }
}
