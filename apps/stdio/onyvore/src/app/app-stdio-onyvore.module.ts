import { Module } from '@nestjs/common';
import {
  StdioTransportModule,
  StdioTransportService,
  StdioMessageBus,
  createStdioMessageBus,
} from '@onivoro/server-stdio';
import { MESSAGE_BUS } from '@onivoro/isomorphic-jsonrpc';
import { AppStdioOnyvoreConfig } from './app-stdio-onyvore-config.class';
import { OnyvoreMessageHandlerService } from './services/onyvore-message-handler.service';
import { NlpService } from './services/nlp.service';
import { SearchIndexService } from './services/search-index.service';
import { LinkGraphService } from './services/link-graph.service';
import { MetadataService } from './services/metadata.service';
import { PersistenceService } from './services/persistence.service';
import { ReconciliationService } from './services/reconciliation.service';
import { TfidfService } from './services/tfidf.service';
import { WikilinkService } from './services/wikilink.service';
import { MentionService } from './services/mention.service';
import { TermStoreService } from './services/term-store.service';
import { IndexingService } from './services/indexing.service';
import { IgnoreService } from './services/ignore.service';
import { SearchService } from './services/search.service';

const config = new AppStdioOnyvoreConfig();

@Module({
  imports: [StdioTransportModule.forRoot()],
  providers: [
    { provide: AppStdioOnyvoreConfig, useValue: config },
    {
      provide: StdioMessageBus,
      useFactory: (transportService: StdioTransportService) =>
        createStdioMessageBus(transportService),
      inject: [StdioTransportService],
    },
    { provide: MESSAGE_BUS, useExisting: StdioMessageBus },
    OnyvoreMessageHandlerService,
    NlpService,
    SearchIndexService,
    LinkGraphService,
    MetadataService,
    PersistenceService,
    ReconciliationService,
    TfidfService,
    WikilinkService,
    MentionService,
    TermStoreService,
    IndexingService,
    IgnoreService,
    SearchService,
  ],
  exports: [StdioMessageBus, MESSAGE_BUS],
})
export class AppStdioOnyvoreModule {}
