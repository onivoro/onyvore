import { MentionService } from './mention.service';
import { TermStoreService } from './term-store.service';

const NB = '/notebooks/test';

function makeService(): { svc: MentionService; store: TermStoreService } {
  const store = new TermStoreService();
  return { svc: new MentionService(store), store };
}

function setTerms(
  store: TermStoreService,
  filePath: string,
  terms: Record<string, number>,
): void {
  store.getOrCreate(NB).set(filePath, new Map(Object.entries(terms)));
}

describe('MentionService', () => {
  describe('titleVariants', () => {
    it('should use the lowercased basename for a root file', () => {
      const { svc } = makeService();
      expect(svc.titleVariants('Overview.md')).toEqual(['overview']);
    });

    it('should add a path-qualified variant for files in subdirectories', () => {
      const { svc } = makeService();
      expect(svc.titleVariants('work/overview.md')).toEqual([
        'overview',
        'work overview',
      ]);
    });

    it('should qualify with the immediate parent only', () => {
      const { svc } = makeService();
      expect(svc.titleVariants('a/b/c/notes.md')).toEqual(['notes', 'c notes']);
    });
  });

  describe('computeOutboundEdges', () => {
    it('should link a note to another whose title it mentions', () => {
      const { svc, store } = makeService();
      svc.registerFile(NB, 'recipes.md');
      svc.registerFile(NB, 'hotsauce.md');
      setTerms(store, 'recipes.md', { hotsauce: 5, vinegar: 2 });

      const edges = svc.computeOutboundEdges(NB, 'recipes.md');

      expect(edges).toEqual([
        {
          source: 'recipes.md',
          target: 'hotsauce.md',
          type: 'mention',
          noun: 'hotsauce',
          count: 5,
        },
      ]);
    });

    it('should never link a note to itself', () => {
      const { svc, store } = makeService();
      svc.registerFile(NB, 'hotsauce.md');
      setTerms(store, 'hotsauce.md', { hotsauce: 9 });

      expect(svc.computeOutboundEdges(NB, 'hotsauce.md')).toEqual([]);
    });

    it('should sum counts across phrases matching the same target', () => {
      const { svc, store } = makeService();
      svc.registerFile(NB, 'notes.md');
      svc.registerFile(NB, 'work/sourdough.md');
      // Both the bare basename and the qualified variant point at one file.
      setTerms(store, 'notes.md', { sourdough: 5, 'work sourdough': 3 });

      const edges = svc.computeOutboundEdges(NB, 'notes.md');

      expect(edges).toHaveLength(1);
      expect(edges[0].count).toBe(8);
      // `noun` reports the single strongest phrase.
      expect(edges[0].noun).toBe('sourdough');
    });

    it('should link to every file sharing a basename', () => {
      const { svc, store } = makeService();
      svc.registerFile(NB, 'index.md');
      svc.registerFile(NB, 'work/overview.md');
      svc.registerFile(NB, 'personal/overview.md');
      setTerms(store, 'index.md', { overview: 2 });

      const targets = svc.computeOutboundEdges(NB, 'index.md').map((e) => e.target);
      expect(targets.sort()).toEqual(['personal/overview.md', 'work/overview.md']);
    });

    it('should disambiguate with the path-qualified title', () => {
      const { svc, store } = makeService();
      svc.registerFile(NB, 'index.md');
      svc.registerFile(NB, 'work/overview.md');
      svc.registerFile(NB, 'personal/overview.md');
      setTerms(store, 'index.md', { 'work overview': 4 });

      const edges = svc.computeOutboundEdges(NB, 'index.md');
      expect(edges.map((e) => e.target)).toEqual(['work/overview.md']);
    });

    it('should return nothing when no term matches a title', () => {
      const { svc, store } = makeService();
      svc.registerFile(NB, 'a.md');
      svc.registerFile(NB, 'b.md');
      setTerms(store, 'a.md', { unrelated: 3 });

      expect(svc.computeOutboundEdges(NB, 'a.md')).toEqual([]);
    });
  });

  describe('computeInboundEdges', () => {
    it('should find existing notes that mention a newly created title', () => {
      const { svc, store } = makeService();
      svc.registerFile(NB, 'recipes.md');
      svc.registerFile(NB, 'dinner.md');
      setTerms(store, 'recipes.md', { hotsauce: 4 });
      setTerms(store, 'dinner.md', { hotsauce: 1 });

      // hotsauce.md is created after the notes that mention it.
      svc.registerFile(NB, 'hotsauce.md');
      setTerms(store, 'hotsauce.md', { pepper: 2 });

      const edges = svc.computeInboundEdges(NB, 'hotsauce.md');

      expect(edges.map((e) => [e.source, e.count]).sort()).toEqual([
        ['dinner.md', 1],
        ['recipes.md', 4],
      ]);
      expect(edges.every((e) => e.target === 'hotsauce.md')).toBe(true);
      expect(edges.every((e) => e.type === 'mention')).toBe(true);
    });

    it('should exclude the file itself', () => {
      const { svc, store } = makeService();
      svc.registerFile(NB, 'hotsauce.md');
      setTerms(store, 'hotsauce.md', { hotsauce: 6 });

      expect(svc.computeInboundEdges(NB, 'hotsauce.md')).toEqual([]);
    });

    it('should return nothing for an unregistered file', () => {
      const { svc, store } = makeService();
      setTerms(store, 'a.md', { ghost: 3 });
      expect(svc.computeInboundEdges(NB, 'ghost.md')).toEqual([]);
    });
  });

  describe('computeAllEdges', () => {
    it('should compute mentions across the whole notebook', () => {
      const { svc, store } = makeService();
      svc.registerFile(NB, 'a.md');
      svc.registerFile(NB, 'b.md');
      setTerms(store, 'a.md', { b: 2 });
      setTerms(store, 'b.md', { a: 3 });

      const edges = svc.computeAllEdges(NB);

      expect(edges.map((e) => `${e.source}->${e.target}`).sort()).toEqual([
        'a.md->b.md',
        'b.md->a.md',
      ]);
    });
  });

  describe('unregisterFile', () => {
    it('should stop the file being a match target', () => {
      const { svc, store } = makeService();
      svc.registerFile(NB, 'notes.md');
      svc.registerFile(NB, 'hotsauce.md');
      setTerms(store, 'notes.md', { hotsauce: 3 });

      svc.unregisterFile(NB, 'hotsauce.md');

      expect(svc.computeOutboundEdges(NB, 'notes.md')).toEqual([]);
    });

    it('should not disturb another file sharing the same basename', () => {
      const { svc, store } = makeService();
      svc.registerFile(NB, 'index.md');
      svc.registerFile(NB, 'work/overview.md');
      svc.registerFile(NB, 'personal/overview.md');
      setTerms(store, 'index.md', { overview: 1 });

      svc.unregisterFile(NB, 'work/overview.md');

      expect(svc.computeOutboundEdges(NB, 'index.md').map((e) => e.target)).toEqual([
        'personal/overview.md',
      ]);
    });
  });

  describe('registerFile', () => {
    it('should replace variants when a file is re-registered', () => {
      const { svc, store } = makeService();
      svc.registerFile(NB, 'work/overview.md');
      svc.registerFile(NB, 'index.md');
      setTerms(store, 'index.md', { 'work overview': 2 });

      // Re-registering must not leave duplicate index entries behind.
      svc.registerFile(NB, 'work/overview.md');

      const edges = svc.computeOutboundEdges(NB, 'index.md');
      expect(edges).toHaveLength(1);
      expect(edges[0].count).toBe(2);
    });
  });

  describe('removeNotebook', () => {
    it('should clear the title index', () => {
      const { svc, store } = makeService();
      svc.registerFile(NB, 'a.md');
      svc.registerFile(NB, 'b.md');
      setTerms(store, 'a.md', { b: 1 });

      svc.removeNotebook(NB);

      expect(svc.computeOutboundEdges(NB, 'a.md')).toEqual([]);
    });
  });
});
