import { WikilinkService } from './wikilink.service';
import { MetadataService } from './metadata.service';

const NB = '/notebooks/test';

describe('WikilinkService', () => {
  let svc: WikilinkService;
  let metadataService: MetadataService;

  beforeEach(() => {
    metadataService = new MetadataService();
    svc = new WikilinkService(metadataService);
  });

  describe('extractAndResolve', () => {
    beforeEach(() => {
      // Register files in metadata
      metadataService.setFile(NB, 'notes/overview.md', 1000);
      metadataService.setFile(NB, 'docs/guide.md', 1000);
      metadataService.setFile(NB, 'source.md', 1000);
    });

    it('should produce explicit edges for resolved wikilinks', () => {
      const content = 'See [[guide]] for details.';
      const edges = svc.extractAndResolve(NB, 'source.md', content);

      expect(edges.length).toBe(1);
      expect(edges[0].source).toBe('source.md');
      expect(edges[0].target).toBe('docs/guide.md');
      expect(edges[0].type).toBe('explicit');
      expect(edges[0].noun).toBe('guide');
      expect(edges[0].count).toBe(100);
    });

    it('should include displayText when present', () => {
      const content = 'See [[guide|the guide]] for details.';
      const edges = svc.extractAndResolve(NB, 'source.md', content);

      expect(edges[0].displayText).toBe('the guide');
    });

    it('should skip self-links', () => {
      const content = 'Linking to [[source]] itself.';
      metadataService.setFile(NB, 'source.md', 1000);
      const edges = svc.extractAndResolve(NB, 'source.md', content);

      expect(edges.length).toBe(0);
    });

    it('should deduplicate multiple links to the same target', () => {
      const content = 'See [[guide]] and also [[guide]] again.';
      const edges = svc.extractAndResolve(NB, 'source.md', content);

      expect(edges.length).toBe(1);
    });

    it('should skip unresolved wikilinks', () => {
      const content = 'See [[nonexistent page]].';
      const edges = svc.extractAndResolve(NB, 'source.md', content);

      expect(edges.length).toBe(0);
    });

    it('should return empty array for content with no wikilinks', () => {
      const edges = svc.extractAndResolve(NB, 'source.md', 'No links here.');
      expect(edges).toEqual([]);
    });

    it('should produce directional edges (outbound only)', () => {
      const content = '[[guide]] and [[overview]]';
      const edges = svc.extractAndResolve(NB, 'source.md', content);

      // All edges should have source.md as source (outbound only, not bidirectional)
      for (const edge of edges) {
        expect(edge.source).toBe('source.md');
      }
    });
  });
});
