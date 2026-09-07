import { IndexingService } from './indexing.service';
import { NlpService } from './nlp.service';
import { SearchIndexService } from './search-index.service';
import { LinkGraphService } from './link-graph.service';
import { MetadataService } from './metadata.service';
import { TfidfService } from './tfidf.service';
import { WikilinkService } from './wikilink.service';
import { MentionService } from './mention.service';
import { TermStoreService } from './term-store.service';
import { AppStdioOnyvoreConfig } from '../app-stdio-onyvore-config.class';

const NB = '/notebooks/test';

function build() {
  const config = new AppStdioOnyvoreConfig();
  const termStore = new TermStoreService();
  const nlp = new NlpService();
  const linkGraph = new LinkGraphService();
  const searchIndex = new SearchIndexService(linkGraph);
  const metadata = new MetadataService();
  const tfidf = new TfidfService(config, termStore);
  const wikilink = new WikilinkService(metadata);
  const mention = new MentionService(termStore);

  const indexing = new IndexingService(
    nlp,
    searchIndex,
    linkGraph,
    metadata,
    tfidf,
    wikilink,
    mention,
  );

  return { indexing, termStore, nlp, linkGraph, searchIndex, metadata, mention };
}

describe('IndexingService', () => {
  describe('registerDocument', () => {
    it('should record a content hash in metadata', async () => {
      const { indexing, metadata } = build();
      await indexing.registerDocument(NB, 'a.md', 'sourdough starter notes', 1);

      const record = metadata.getFile(NB, 'a.md');
      expect(record?.hash).toBe(indexing.hash('sourdough starter notes'));
    });

    it('should reuse a caller-supplied hash', async () => {
      const { indexing, metadata } = build();
      await indexing.registerDocument(NB, 'a.md', 'body', 1, 'precomputed');

      expect(metadata.getFile(NB, 'a.md')?.hash).toBe('precomputed');
    });
  });

  describe('renameDocument', () => {
    it('should move terms without re-running extraction', async () => {
      const { indexing, termStore, nlp } = build();
      const content = 'kubernetes cluster deployment notes';
      await indexing.registerDocument(NB, 'old.md', content, 1);

      const before = termStore.get(NB, 'old.md');
      const extract = jest.spyOn(nlp, 'extractTerms');

      await indexing.renameDocument(NB, 'old.md', 'new.md', content, 2);

      // The expensive NLP pass is exactly what a rename should skip.
      expect(extract).not.toHaveBeenCalled();
      expect(termStore.get(NB, 'old.md')).toBeUndefined();
      expect(termStore.get(NB, 'new.md')).toBe(before);
    });

    it('should move the search index entry', async () => {
      const { indexing, searchIndex } = build();
      await indexing.registerDocument(NB, 'old.md', 'findable content', 1);

      await indexing.renameDocument(NB, 'old.md', 'new.md', 'findable content', 2);

      expect(searchIndex.getIndexedPaths(NB)).toEqual(['new.md']);
      const hits = await searchIndex.searchNotebook(NB, 'findable');
      expect(hits.map((h) => h.relativePath)).toEqual(['new.md']);
    });

    it('should move metadata and keep the hash', async () => {
      const { indexing, metadata } = build();
      const content = 'body text';
      await indexing.registerDocument(NB, 'old.md', content, 1);

      await indexing.renameDocument(NB, 'old.md', 'new.md', content, 99);

      expect(metadata.getFile(NB, 'old.md')).toBeUndefined();
      expect(metadata.getFile(NB, 'new.md')).toEqual({
        relativePath: 'new.md',
        mtimeMs: 99,
        hash: indexing.hash(content),
      });
    });

    it('should retarget mentions to the new title', async () => {
      const { indexing, mention } = build();
      // A note that mentions "hotsauce" throughout.
      await indexing.registerDocument(
        NB,
        'recipes.md',
        'The hotsauce recipe needs hotsauce and more hotsauce.',
        1,
      );
      await indexing.registerDocument(NB, 'hotsauce.md', 'pepper vinegar salt', 1);

      expect(
        mention.computeOutboundEdges(NB, 'recipes.md').map((e) => e.target),
      ).toEqual(['hotsauce.md']);

      // Renaming the target means the old title no longer matches.
      await indexing.renameDocument(
        NB,
        'hotsauce.md',
        'chili-sauce.md',
        'pepper vinegar salt',
        2,
      );

      expect(mention.computeOutboundEdges(NB, 'recipes.md')).toEqual([]);
    });

    it('should pick up mentions of the new title', async () => {
      const { indexing, mention } = build();
      await indexing.registerDocument(NB, 'notes.md', 'Notes about sourdough.', 1);
      await indexing.registerDocument(NB, 'bread.md', 'flour water salt', 1);

      expect(mention.computeInboundEdges(NB, 'bread.md')).toEqual([]);

      await indexing.renameDocument(
        NB,
        'bread.md',
        'sourdough.md',
        'flour water salt',
        2,
      );

      expect(
        mention.computeInboundEdges(NB, 'sourdough.md').map((e) => e.source),
      ).toEqual(['notes.md']);
    });

    it('should drop edges attached to the old path', async () => {
      const { indexing, linkGraph } = build();
      await indexing.registerDocument(NB, 'a.md', 'See [[old]] for details.', 1);
      await indexing.registerDocument(NB, 'old.md', 'some content here', 1);
      indexing.computeEdges(NB, 'a.md', 'See [[old]] for details.', {
        refreshInbound: false,
      });

      expect(
        linkGraph.getLinksForNote(NB, 'a.md').explicitOutbound.map((l) => l.notePath),
      ).toEqual(['old.md']);

      await indexing.renameDocument(NB, 'old.md', 'new.md', 'some content here', 2);

      // The wikilink now points at nothing, and no stale edge survives.
      expect(linkGraph.getLinksForNote(NB, 'new.md').explicitInbound).toEqual([]);
      expect(linkGraph.getLinksForNote(NB, 'old.md').explicitInbound).toEqual([]);
    });

    it('should leave the note registered for orphan detection', async () => {
      const { indexing, linkGraph } = build();
      await indexing.registerDocument(NB, 'old.md', 'lonely note', 1);

      await indexing.renameDocument(NB, 'old.md', 'new.md', 'lonely note', 2);

      expect(linkGraph.getOrphans(NB)).toEqual(['new.md']);
    });

    it('should do nothing for an unknown source path', async () => {
      const { indexing, searchIndex } = build();
      await indexing.renameDocument(NB, 'missing.md', 'new.md', 'content', 1);

      // The target is still indexed — the move degrades to a plain add.
      expect(searchIndex.getIndexedPaths(NB)).toEqual(['new.md']);
    });
  });
});
