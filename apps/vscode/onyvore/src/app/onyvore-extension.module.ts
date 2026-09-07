import * as vscode from 'vscode';
import * as path from 'path';
import { Module } from '@nestjs/common';
import { VscodeExtensionModule } from '@onivoro/server-vscode';
import { OnyvoreWebviewProvider } from './classes/onyvore-webview-provider.class';
import { SecondaryViewsService } from './services/secondary-views.service';
import { OnyvoreCommandHandlerService } from './services/onyvore-command-handler.service';
import { OnyvoreWebviewHandlerService } from './services/onyvore-webview-handler.service';
import { OnyvoreServerNotificationHandlerService } from './services/onyvore-server-notification-handler.service';
import { NotebookDiscoveryService } from './services/notebook-discovery.service';
import { ActiveNotebookService } from './services/active-notebook.service';
import { FileWatcherService } from './services/file-watcher.service';
import { NotebookFilesService } from './services/notebook-files.service';
import { OnyvoreSettingsService } from './services/onyvore-settings.service';
import { WikilinkFeaturesService } from './services/wikilink-features.service';
import { WikilinkDiagnosticsService } from './services/wikilink-diagnostics.service';

function bundlePath(...segments: string[]): string {
  return path.join(__dirname, ...segments);
}

@VscodeExtensionModule({
  name: 'Onyvore',
  serverScript: bundlePath('server', 'main.js'),
  webviewViewType: OnyvoreWebviewProvider.viewType,
  createWebviewProvider: () =>
    new OnyvoreWebviewProvider(vscode.Uri.file(__dirname)),
  commandHandlerTokens: [OnyvoreCommandHandlerService],
  serverOutputChannel: {
    name: 'Onyvore Server',
    showOnError: true,
  },
})
@Module({
  providers: [
    OnyvoreCommandHandlerService,
    OnyvoreWebviewHandlerService,
    OnyvoreServerNotificationHandlerService,
    NotebookDiscoveryService,
    ActiveNotebookService,
    FileWatcherService,
    NotebookFilesService,
    OnyvoreSettingsService,
    SecondaryViewsService,
    WikilinkFeaturesService,
    WikilinkDiagnosticsService,
  ],
})
export class OnyvoreExtensionModule {}
