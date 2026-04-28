import { TfidfService } from './tfidf.service';
import { AppStdioOnyvoreConfig } from '../app-stdio-onyvore-config.class';

function makeService(threshold = 0.15): TfidfService {
  const config = new AppStdioOnyvoreConfig();
  (config as any).similarityThreshold = threshold;
  return new TfidfService(config);
}

function terms(entries: Record<string, number>): Map<string, number> {
  return new Map(Object.entries(entries));
}

const NB = '/notebooks/test';

describe('TfidfService', () => {
  describe('setDocument / removeDocument', () => {
    it('should track document count', () => {
      const svc = makeService();
      svc.setDocument(NB, 'a.md', terms({ kubernetes: 3 }));
      svc.setDocument(NB, 'b.md', terms({ docker: 2 }));

      const corpus = svc.getOrCreateCorpus(NB);
      expect(corpus.docCount).toBe(2);
      expect(corpus.tf.size).toBe(2);
    });

    it('should maintain document frequency correctly', () => {
      const svc = makeService();
      svc.setDocument(NB, 'a.md', terms({ kubernetes: 3, container: 1 }));
      svc.setDocument(NB, 'b.md', terms({ docker: 2, container: 5 }));

      const corpus = svc.getOrCreateCorpus(NB);
      expect(corpus.df.get('kubernetes')).toBe(1);
      expect(corpus.df.get('docker')).toBe(1);
      expect(corpus.df.get('container')).toBe(2);
    });

    it('should update DF when a document is replaced', () => {
      const svc = makeService();
      svc.setDocument(NB, 'a.md', terms({ kubernetes: 3, pod: 1 }));
      svc.setDocument(NB, 'b.md', terms({ kubernetes: 1 }));

      // Replace a.md — remove "pod", keep "kubernetes"
      svc.setDocument(NB, 'a.md', terms({ kubernetes: 5, service: 2 }));

      const corpus = svc.getOrCreateCorpus(NB);
      expect(corpus.docCount).toBe(2); // unchanged
      expect(corpus.df.get('pod')).toBeUndefined(); // was only in a.md
      expect(corpus.df.get('kubernetes')).toBe(2); // still in both
      expect(corpus.df.get('service')).toBe(1); // new in a.md
    });

    it('should decrement DF and docCount on remove', () => {
      const svc = makeService();
      svc.setDocument(NB, 'a.md', terms({ kubernetes: 3 }));
      svc.setDocument(NB, 'b.md', terms({ kubernetes: 1, docker: 2 }));

      svc.removeDocument(NB, 'a.md');

      const corpus = svc.getOrCreateCorpus(NB);
      expect(corpus.docCount).toBe(1);
      expect(corpus.df.get('kubernetes')).toBe(1);
      expect(corpus.df.get('docker')).toBe(1);
      expect(corpus.tf.has('a.md')).toBe(false);
    });

    it('should handle removing a non-existent document gracefully', () => {
      const svc = makeService();
      expect(() => svc.removeDocument(NB, 'missing.md')).not.toThrow();
    });
  });

  describe('computeEdgesForDocument', () => {
    it('should return empty for a single document corpus', () => {
      const svc = makeService();
      svc.setDocument(NB, 'a.md', terms({ kubernetes: 3 }));

      const edges = svc.computeEdgesForDocument(NB, 'a.md');
      expect(edges).toEqual([]);
    });

    it('should create edges for similar documents', () => {
      const svc = makeService(0.01); // low threshold to ensure matches
      svc.setDocument(NB, 'a.md', terms({ kubernetes: 5, cluster: 3, deployment: 2 }));
      svc.setDocument(NB, 'b.md', terms({ kubernetes: 4, cluster: 2, pod: 3 }));
      svc.setDocument(NB, 'c.md', terms({ javascript: 5, react: 3, component: 2 }));

      const edges = svc.computeEdgesForDocument(NB, 'a.md');

      // Should link a.md <-> b.md (shared kubernetes, cluster terms)
      const toB = edges.filter(
        (e) => e.source === 'a.md' && e.target === 'b.md',
      );
      const fromB = edges.filter(
        (e) => e.source === 'b.md' && e.target === 'a.md',
      );
      expect(toB.length).toBe(1);
      expect(fromB.length).toBe(1);
      expect(toB[0].count).toBe(fromB[0].count); // symmetric

      // Should NOT link a.md <-> c.md (no shared terms)
      const toC = edges.filter(
        (e) =>
          (e.source === 'a.md' && e.target === 'c.md') ||
          (e.source === 'c.md' && e.target === 'a.md'),
      );
      expect(toC.length).toBe(0);
    });

    it('should produce edges in both directions', () => {
      const svc = makeService(0.01);
      // Need a 3rd doc so "topic" has IDF > 0 (doesn't appear in all docs)
      svc.setDocument(NB, 'a.md', terms({ topic: 5 }));
      svc.setDocument(NB, 'b.md', terms({ topic: 3 }));
      svc.setDocument(NB, 'c.md', terms({ other: 1 }));

      const edges = svc.computeEdgesForDocument(NB, 'a.md');
      const sources = edges.map((e) => e.source);
      expect(sources).toContain('a.md');
      expect(sources).toContain('b.md');
    });

    it('should set noun to the top contributing shared term', () => {
      const svc = makeService(0.01);
      // "rare" has low DF -> high IDF -> dominates the dot product
      svc.setDocument(NB, 'a.md', terms({ common: 10, rare: 2 }));
      svc.setDocument(NB, 'b.md', terms({ common: 8, rare: 1 }));
      // Add a third doc that also has "common" to lower its IDF
      svc.setDocument(NB, 'c.md', terms({ common: 5 }));

      const edges = svc.computeEdgesForDocument(NB, 'a.md');
      const edgeToB = edges.find(
        (e) => e.source === 'a.md' && e.target === 'b.md',
      );
      expect(edgeToB).toBeDefined();
      expect(edgeToB!.noun).toBe('rare');
    });

    it('should respect similarity threshold', () => {
      const svc = makeService(0.99); // very high threshold
      svc.setDocument(NB, 'a.md', terms({ kubernetes: 5, deployment: 2 }));
      svc.setDocument(NB, 'b.md', terms({ kubernetes: 1, react: 10 }));

      const edges = svc.computeEdgesForDocument(NB, 'a.md');
      expect(edges.length).toBe(0);
    });

    it('should set count as similarity percentage (0-100)', () => {
      const svc = makeService(0.01);
      svc.setDocument(NB, 'a.md', terms({ topic: 5 }));
      svc.setDocument(NB, 'b.md', terms({ topic: 3 }));

      const edges = svc.computeEdgesForDocument(NB, 'a.md');
      // identical term sets -> cosine sim = 1.0 -> count = 100
      // (only one shared term, IDF is log(2/2) = 0, so actually no edge since IDF=0)
      // Wait - with only 2 docs both containing "topic", IDF(topic) = log(2/2) = 0, so no edges
      // Let me add a third doc without "topic" so IDF > 0
      const svc2 = makeService(0.01);
      svc2.setDocument(NB, 'a.md', terms({ topic: 5 }));
      svc2.setDocument(NB, 'b.md', terms({ topic: 3 }));
      svc2.setDocument(NB, 'c.md', terms({ other: 1 }));

      const edges2 = svc2.computeEdgesForDocument(NB, 'a.md');
      const edge = edges2.find(
        (e) => e.source === 'a.md' && e.target === 'b.md',
      );
      expect(edge).toBeDefined();
      expect(edge!.count).toBe(100); // identical single-term vectors -> perfect similarity
    });

    it('should skip documents with empty terms', () => {
      const svc = makeService(0.01);
      svc.setDocument(NB, 'a.md', terms({ topic: 5 }));
      svc.setDocument(NB, 'b.md', terms({}));
      svc.setDocument(NB, 'c.md', terms({ other: 1 }));

      const edges = svc.computeEdgesForDocument(NB, 'a.md');
      const toB = edges.filter(
        (e) => e.target === 'b.md' || e.source === 'b.md',
      );
      expect(toB.length).toBe(0);
    });
  });

  describe('computeAllEdges', () => {
    it('should compute edges for entire corpus', () => {
      const svc = makeService(0.01);
      svc.setDocument(NB, 'a.md', terms({ kubernetes: 5, cluster: 3 }));
      svc.setDocument(NB, 'b.md', terms({ kubernetes: 4, pod: 3 }));
      svc.setDocument(NB, 'c.md', terms({ javascript: 5, react: 3 }));

      const edges = svc.computeAllEdges(NB);

      // a <-> b should be linked (shared "kubernetes")
      const abEdges = edges.filter(
        (e) =>
          (e.source === 'a.md' && e.target === 'b.md') ||
          (e.source === 'b.md' && e.target === 'a.md'),
      );
      expect(abEdges.length).toBe(2); // both directions

      // a <-> c should NOT be linked
      const acEdges = edges.filter(
        (e) =>
          (e.source === 'a.md' && e.target === 'c.md') ||
          (e.source === 'c.md' && e.target === 'a.md'),
      );
      expect(acEdges.length).toBe(0);
    });

    it('should return empty for fewer than 2 documents', () => {
      const svc = makeService();
      svc.setDocument(NB, 'a.md', terms({ kubernetes: 5 }));
      expect(svc.computeAllEdges(NB)).toEqual([]);
    });

    it('should produce same results as individual computeEdgesForDocument calls', () => {
      const svc = makeService(0.01);
      // Use terms that don't all appear in every doc so IDF > 0
      svc.setDocument(NB, 'a.md', terms({ kubernetes: 5, cluster: 3 }));
      svc.setDocument(NB, 'b.md', terms({ kubernetes: 4, pod: 3 }));
      svc.setDocument(NB, 'c.md', terms({ javascript: 5, react: 3 }));

      const allEdges = svc.computeAllEdges(NB);

      // Check that a->b edges exist and have the same score via both methods
      const abFromAll = allEdges.find(
        (e) => e.source === 'a.md' && e.target === 'b.md',
      );
      const edgesForA = svc.computeEdgesForDocument(NB, 'a.md');
      const abFromSingle = edgesForA.find(
        (e) => e.source === 'a.md' && e.target === 'b.md',
      );

      expect(abFromAll).toBeDefined();
      expect(abFromSingle).toBeDefined();
      expect(abFromAll!.count).toBe(abFromSingle!.count);
      expect(abFromAll!.noun).toBe(abFromSingle!.noun);
    });
  });

  describe('terms that appear in every document', () => {
    it('should have IDF=0 and not contribute to similarity', () => {
      const svc = makeService(0.01);
      // "common" appears in all 3 docs -> IDF = log(3/3) = 0
      // "rare" appears in 2 docs -> IDF = log(3/2) > 0
      svc.setDocument(NB, 'a.md', terms({ common: 10, rare: 2 }));
      svc.setDocument(NB, 'b.md', terms({ common: 8, rare: 1 }));
      svc.setDocument(NB, 'c.md', terms({ common: 5 }));

      const edges = svc.computeEdgesForDocument(NB, 'a.md');
      const edgeToB = edges.find(
        (e) => e.source === 'a.md' && e.target === 'b.md',
      );
      const edgeToC = edges.find(
        (e) => e.source === 'a.md' && e.target === 'c.md',
      );

      // a <-> b linked via "rare"
      expect(edgeToB).toBeDefined();
      expect(edgeToB!.noun).toBe('rare');

      // a <-> c NOT linked (only shared term is "common" with IDF=0)
      expect(edgeToC).toBeUndefined();
    });
  });

  describe('serialize / deserialize', () => {
    it('should round-trip corpus state', () => {
      const svc = makeService();
      svc.setDocument(NB, 'a.md', terms({ kubernetes: 5, cluster: 3 }));
      svc.setDocument(NB, 'b.md', terms({ docker: 2, cluster: 1 }));

      const serialized = svc.serialize(NB);
      expect(serialized).not.toBeNull();

      const svc2 = makeService();
      svc2.deserialize(NB, serialized!);

      const corpus = svc2.getOrCreateCorpus(NB);
      expect(corpus.docCount).toBe(2);
      expect(corpus.tf.get('a.md')?.get('kubernetes')).toBe(5);
      expect(corpus.tf.get('b.md')?.get('docker')).toBe(2);
      expect(corpus.df.get('cluster')).toBe(2);
      expect(corpus.df.get('kubernetes')).toBe(1);
    });

    it('should return null for non-existent corpus', () => {
      const svc = makeService();
      expect(svc.serialize('nonexistent')).toBeNull();
    });

    it('should produce identical edges after round-trip', () => {
      const svc = makeService(0.01);
      svc.setDocument(NB, 'a.md', terms({ kubernetes: 5, cluster: 3 }));
      svc.setDocument(NB, 'b.md', terms({ kubernetes: 4, pod: 3 }));
      svc.setDocument(NB, 'c.md', terms({ javascript: 5, react: 3 }));

      const edgesBefore = svc.computeAllEdges(NB);
      const serialized = svc.serialize(NB)!;

      const svc2 = makeService(0.01);
      svc2.deserialize(NB, serialized);
      const edgesAfter = svc2.computeAllEdges(NB);

      expect(edgesAfter.length).toBe(edgesBefore.length);
      for (const before of edgesBefore) {
        const after = edgesAfter.find(
          (e) => e.source === before.source && e.target === before.target,
        );
        expect(after).toBeDefined();
        expect(after!.count).toBe(before.count);
      }
    });
  });

  describe('removeCorpus', () => {
    it('should remove all state for a notebook', () => {
      const svc = makeService();
      svc.setDocument(NB, 'a.md', terms({ kubernetes: 5 }));
      svc.removeCorpus(NB);

      const corpus = svc.getOrCreateCorpus(NB);
      expect(corpus.docCount).toBe(0);
      expect(corpus.tf.size).toBe(0);
      expect(corpus.df.size).toBe(0);
    });
  });

  describe('the generic filename problem', () => {
    it('should NOT link overview files with different content', () => {
      const svc = makeService(0.1);

      // Simulate the real-world problem: multiple overview.md files
      // with topically different content
      svc.setDocument(
        NB,
        'kubernetes/overview.md',
        terms({ kubernetes: 8, cluster: 5, pod: 4, deployment: 3, node: 2 }),
      );
      svc.setDocument(
        NB,
        'react/overview.md',
        terms({ react: 8, component: 5, hook: 4, state: 3, jsx: 2 }),
      );
      svc.setDocument(
        NB,
        'kubernetes/deployments.md',
        terms({ kubernetes: 3, deployment: 7, replica: 4, rollout: 3 }),
      );

      const edges = svc.computeAllEdges(NB);

      // kubernetes/overview.md <-> kubernetes/deployments.md SHOULD be linked
      const k8sLinks = edges.filter(
        (e) =>
          (e.source === 'kubernetes/overview.md' &&
            e.target === 'kubernetes/deployments.md') ||
          (e.source === 'kubernetes/deployments.md' &&
            e.target === 'kubernetes/overview.md'),
      );
      expect(k8sLinks.length).toBe(2);

      // kubernetes/overview.md <-> react/overview.md should NOT be linked
      const crossLinks = edges.filter(
        (e) =>
          (e.source === 'kubernetes/overview.md' &&
            e.target === 'react/overview.md') ||
          (e.source === 'react/overview.md' &&
            e.target === 'kubernetes/overview.md'),
      );
      expect(crossLinks.length).toBe(0);
    });
  });
});
