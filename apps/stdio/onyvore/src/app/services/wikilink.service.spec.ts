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

  describe('parseWikilinks', () => {
    it('should parse simple wikilinks', () => {
      const result = svc.parseWikilinks('See [[My Note]] for details.');
      expect(result).toEqual([{ target: 'My Note', displayText: null }]);
    });

    it('should parse wikilinks with display text', () => {
      const result = svc.parseWikilinks('See [[My Note|custom label]] for details.');
      expect(result).toEqual([{ target: 'My Note', displayText: 'custom label' }]);
    });

    it('should parse multiple wikilinks', () => {
      const result = svc.parseWikilinks('Links to [[A]], [[B|beta]], and [[C]].');
      expect(result.length).toBe(3);
      expect(result[0]).toEqual({ target: 'A', displayText: null });
      expect(result[1]).toEqual({ target: 'B', displayText: 'beta' });
      expect(result[2]).toEqual({ target: 'C', displayText: null });
    });

    it('should skip wikilinks inside fenced code blocks', () => {
      const content = `
Some text [[valid]].

\`\`\`
[[inside code block]]
\`\`\`

More text [[also valid]].
`;
      const result = svc.parseWikilinks(content);
      expect(result.length).toBe(2);
      expect(result[0].target).toBe('valid');
      expect(result[1].target).toBe('also valid');
    });

    it('should skip wikilinks inside inline code', () => {
      const result = svc.parseWikilinks('Use `[[not a link]]` syntax. But [[real link]] works.');
      expect(result.length).toBe(1);
      expect(result[0].target).toBe('real link');
    });

    it('should trim whitespace from target and display text', () => {
      const result = svc.parseWikilinks('[[  My Note  |  label  ]]');
      expect(result[0].target).toBe('My Note');
      expect(result[0].displayText).toBe('label');
    });

    it('should skip empty wikilinks', () => {
      const result = svc.parseWikilinks('[[ ]] and [[|display]]');
      expect(result.length).toBe(0);
    });

    it('should handle wikilinks with .md extension in target', () => {
      const result = svc.parseWikilinks('See [[My Note.md]]');
      expect(result[0].target).toBe('My Note.md');
    });

    it('should handle wikilinks with path separators', () => {
      const result = svc.parseWikilinks('See [[docs/guide]]');
      expect(result[0].target).toBe('docs/guide');
    });
  });

  describe('resolveTarget', () => {
    const allFiles = [
      'notes/overview.md',
      'docs/guide.md',
      'kubernetes/overview.md',
      'react/components.md',
      'readme.md',
    ];

    it('should resolve basename match (case-insensitive)', () => {
      const result = svc.resolveTarget('guide', allFiles);
      expect(result).toBe('docs/guide.md');
    });

    it('should resolve basename match case-insensitively', () => {
      const result = svc.resolveTarget('Guide', allFiles);
      expect(result).toBe('docs/guide.md');
    });

    it('should resolve path-based match', () => {
      const result = svc.resolveTarget('kubernetes/overview', allFiles);
      expect(result).toBe('kubernetes/overview.md');
    });

    it('should prefer shortest path when multiple basename matches exist', () => {
      // Both 'notes/overview.md' and 'kubernetes/overview.md' match
      // 'notes/overview.md' is shorter
      const result = svc.resolveTarget('overview', allFiles);
      expect(result).toBe('notes/overview.md');
    });

    it('should return null for unresolved targets', () => {
      const result = svc.resolveTarget('nonexistent', allFiles);
      expect(result).toBeNull();
    });

    it('should strip .md extension from target before matching', () => {
      const result = svc.resolveTarget('readme.md', allFiles);
      expect(result).toBe('readme.md');
    });

    it('should return null for empty target', () => {
      const result = svc.resolveTarget('', allFiles);
      expect(result).toBeNull();
    });

    it('should handle path-based match case-insensitively', () => {
      const result = svc.resolveTarget('Docs/Guide', allFiles);
      expect(result).toBe('docs/guide.md');
    });
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
