import { SearchIndexService } from './search-index.service';
import { LinkGraphService } from './link-graph.service';

const NB = '/notebooks/test';

function makeService(): SearchIndexService {
  return new SearchIndexService(new LinkGraphService());
}

describe('SearchIndexService', () => {
  describe('removeDocument', () => {
    it('should remove only the requested document', async () => {
      const svc = makeService();
      await svc.addDocument(NB, 'guide.md', 'guide', 'alpha content');
      await svc.addDocument(NB, 'tutorials/guide.md', 'tutorials guide', 'beta content');

      await svc.removeDocument(NB, 'guide.md');

      expect(svc.getIndexedPaths(NB)).toEqual(['tutorials/guide.md']);
      const { hits: results } = await svc.searchNotebook(NB, ['content']);
      expect(results.map((r) => r.relativePath)).toEqual(['tutorials/guide.md']);
    });

    it('should not remove a basename sibling when the target is already gone', async () => {
      const svc = makeService();
      await svc.addDocument(NB, 'guide.md', 'guide', 'alpha content');
      await svc.addDocument(NB, 'tutorials/guide.md', 'tutorials guide', 'beta content');

      // Repeated removal of the same path must be a no-op, not a wrong delete.
      await svc.removeDocument(NB, 'guide.md');
      await svc.removeDocument(NB, 'guide.md');

      expect(svc.getIndexedPaths(NB)).toEqual(['tutorials/guide.md']);
      const { hits: results } = await svc.searchNotebook(NB, ['beta']);
      expect(results.map((r) => r.relativePath)).toEqual(['tutorials/guide.md']);
    });

    it('should ignore removal of a path that was never indexed', async () => {
      const svc = makeService();
      await svc.addDocument(NB, 'work/overview.md', 'work overview', 'alpha');
      await svc.addDocument(NB, 'personal/overview.md', 'personal overview', 'beta');

      await svc.removeDocument(NB, 'drafts/overview.md');

      expect(svc.getIndexedPaths(NB).sort()).toEqual([
        'personal/overview.md',
        'work/overview.md',
      ]);
    });
  });

  describe('addDocument', () => {
    it('should replace rather than duplicate on repeated adds', async () => {
      const svc = makeService();
      await svc.addDocument(NB, 'note.md', 'note', 'original body');
      await svc.addDocument(NB, 'note.md', 'note', 'revised body');

      expect(svc.getIndexedPaths(NB)).toEqual(['note.md']);

      const { hits: stale } = await svc.searchNotebook(NB, ['original']);
      expect(stale).toEqual([]);

      const { hits: fresh } = await svc.searchNotebook(NB, ['revised']);
      expect(fresh.map((r) => r.relativePath)).toEqual(['note.md']);
    });

    it('should leave one document after add/remove/add cycles', async () => {
      const svc = makeService();
      await svc.addDocument(NB, 'note.md', 'note', 'first');
      await svc.removeDocument(NB, 'note.md');
      await svc.addDocument(NB, 'note.md', 'note', 'second');

      expect(svc.getIndexedPaths(NB)).toEqual(['note.md']);
      expect(svc.hasDocument(NB, 'note.md')).toBe(true);
    });
  });

  describe('updateDocument', () => {
    it('should index a path that was not previously present', async () => {
      const svc = makeService();
      await svc.updateDocument(NB, 'new.md', 'new', 'unseen body');

      expect(svc.getIndexedPaths(NB)).toEqual(['new.md']);
      const { hits: results } = await svc.searchNotebook(NB, ['unseen']);
      expect(results.map((r) => r.relativePath)).toEqual(['new.md']);
    });
  });

  describe('serialize / deserialize', () => {
    it('should round-trip documents and their ids', async () => {
      const svc = makeService();
      await svc.addDocument(NB, 'a.md', 'a', 'alpha content');
      await svc.addDocument(NB, 'nested/a.md', 'nested a', 'beta content');

      const data = await svc.serialize(NB);
      expect(data).not.toBeNull();

      const restored = makeService();
      await restored.deserialize(NB, data!);

      expect(restored.getIndexedPaths(NB).sort()).toEqual(['a.md', 'nested/a.md']);

      // Removal must still be precise against a restored id map.
      await restored.removeDocument(NB, 'a.md');
      expect(restored.getIndexedPaths(NB)).toEqual(['nested/a.md']);

      const { hits } = await restored.searchNotebook(NB, ['beta']);
      expect(hits.map((r) => r.relativePath)).toEqual(['nested/a.md']);
    });

    it('should reject an unreadable index format so callers can rebuild', async () => {
      const svc = makeService();
      const legacy = Buffer.from(JSON.stringify({ docs: {}, index: {} }));

      await expect(svc.deserialize(NB, legacy)).rejects.toThrow(
        /Unsupported index format/,
      );
    });
  });

  describe('removeIndex', () => {
    it('should clear tracked ids along with the index', async () => {
      const svc = makeService();
      await svc.addDocument(NB, 'a.md', 'a', 'alpha');

      svc.removeIndex(NB);

      expect(svc.getIndexedPaths(NB)).toEqual([]);
      expect(svc.hasDocument(NB, 'a.md')).toBe(false);
    });
  });
});
