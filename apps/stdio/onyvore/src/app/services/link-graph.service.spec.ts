import { LinkGraphService } from './link-graph.service';
import type { Edge } from '@onivoro/isomorphic-onyvore';

const NB = '/notebooks/test';

function edge(source: string, target: string, noun = 'term', count = 50): Edge {
  return { source, target, noun, count };
}

describe('LinkGraphService', () => {
  let svc: LinkGraphService;

  beforeEach(() => {
    svc = new LinkGraphService();
  });

  describe('registerFile / unregisterFile', () => {
    it('should track registered files', () => {
      svc.registerFile(NB, 'a.md');
      svc.registerFile(NB, 'b.md');

      const graph = svc.getOrCreateGraph(NB);
      expect(graph.files.has('a.md')).toBe(true);
      expect(graph.files.has('b.md')).toBe(true);
    });

    it('should remove file on unregister', () => {
      svc.registerFile(NB, 'a.md');
      svc.unregisterFile(NB, 'a.md');

      const graph = svc.getOrCreateGraph(NB);
      expect(graph.files.has('a.md')).toBe(false);
    });
  });

  describe('replaceAllEdges', () => {
    it('should insert all edges and build indexes', () => {
      svc.replaceAllEdges(NB, [
        edge('a.md', 'b.md'),
        edge('b.md', 'a.md'),
        edge('a.md', 'c.md'),
        edge('c.md', 'a.md'),
      ]);

      const links = svc.getLinksForNote(NB, 'a.md');
      expect(links.outbound.length).toBe(2);
      expect(links.inbound.length).toBe(2);
    });

    it('should clear existing edges first', () => {
      svc.replaceAllEdges(NB, [edge('a.md', 'b.md'), edge('b.md', 'a.md')]);
      svc.replaceAllEdges(NB, [edge('x.md', 'y.md'), edge('y.md', 'x.md')]);

      const linksA = svc.getLinksForNote(NB, 'a.md');
      expect(linksA.outbound.length).toBe(0);
      expect(linksA.inbound.length).toBe(0);

      const linksX = svc.getLinksForNote(NB, 'x.md');
      expect(linksX.outbound.length).toBe(1);
    });
  });

  describe('replaceEdgesForFile', () => {
    it('should replace edges for a specific file', () => {
      svc.replaceAllEdges(NB, [
        edge('a.md', 'b.md', 'old', 30),
        edge('b.md', 'a.md', 'old', 30),
        edge('a.md', 'c.md', 'old', 20),
        edge('c.md', 'a.md', 'old', 20),
      ]);

      // Replace edges for a.md — now only links to d.md
      svc.replaceEdgesForFile(NB, 'a.md', [
        edge('a.md', 'd.md', 'new', 80),
        edge('d.md', 'a.md', 'new', 80),
      ]);

      const linksA = svc.getLinksForNote(NB, 'a.md');
      expect(linksA.outbound.length).toBe(1);
      expect(linksA.outbound[0].notePath).toBe('d.md');
      expect(linksA.inbound.length).toBe(1);
      expect(linksA.inbound[0].notePath).toBe('d.md');

      // Old edges to b.md and c.md should be gone
      const linksB = svc.getLinksForNote(NB, 'b.md');
      expect(linksB.outbound.length).toBe(0);
      expect(linksB.inbound.length).toBe(0);
    });

    it('should handle replacing with empty edges', () => {
      svc.replaceAllEdges(NB, [
        edge('a.md', 'b.md'),
        edge('b.md', 'a.md'),
      ]);

      svc.replaceEdgesForFile(NB, 'a.md', []);

      const linksA = svc.getLinksForNote(NB, 'a.md');
      expect(linksA.outbound.length).toBe(0);
      expect(linksA.inbound.length).toBe(0);
    });
  });

  describe('removeAllEdgesForFile', () => {
    it('should remove all edges involving the file', () => {
      svc.replaceAllEdges(NB, [
        edge('a.md', 'b.md'),
        edge('b.md', 'a.md'),
        edge('b.md', 'c.md'),
        edge('c.md', 'b.md'),
      ]);

      svc.removeAllEdgesForFile(NB, 'b.md');

      const linksB = svc.getLinksForNote(NB, 'b.md');
      expect(linksB.outbound.length).toBe(0);
      expect(linksB.inbound.length).toBe(0);

      // a.md and c.md should also lose their edges to b.md
      const linksA = svc.getLinksForNote(NB, 'a.md');
      expect(linksA.outbound.length).toBe(0);
    });
  });

  describe('getLinksForNote', () => {
    it('should sort links by count descending', () => {
      svc.replaceAllEdges(NB, [
        edge('a.md', 'b.md', 'low', 20),
        edge('a.md', 'c.md', 'high', 90),
        edge('a.md', 'd.md', 'mid', 50),
      ]);

      const links = svc.getLinksForNote(NB, 'a.md');
      expect(links.outbound[0].count).toBe(90);
      expect(links.outbound[1].count).toBe(50);
      expect(links.outbound[2].count).toBe(20);
    });

    it('should return empty for unknown notebook', () => {
      const links = svc.getLinksForNote('unknown', 'a.md');
      expect(links.outbound).toEqual([]);
      expect(links.inbound).toEqual([]);
    });

    it('should populate noteTitle from file path', () => {
      svc.replaceAllEdges(NB, [edge('a.md', 'docs/readme.md', 'term', 50)]);

      const links = svc.getLinksForNote(NB, 'a.md');
      expect(links.outbound[0].noteTitle).toBe('readme');
    });
  });

  describe('getOrphans', () => {
    it('should return files with no edges', () => {
      svc.registerFile(NB, 'a.md');
      svc.registerFile(NB, 'b.md');
      svc.registerFile(NB, 'c.md');

      svc.replaceAllEdges(NB, [
        edge('a.md', 'b.md'),
        edge('b.md', 'a.md'),
      ]);

      const orphans = svc.getOrphans(NB);
      expect(orphans).toEqual(['c.md']);
    });

    it('should return all files when no edges exist', () => {
      svc.registerFile(NB, 'a.md');
      svc.registerFile(NB, 'b.md');

      const orphans = svc.getOrphans(NB);
      expect(orphans).toContain('a.md');
      expect(orphans).toContain('b.md');
    });

    it('should return empty when all files have edges', () => {
      svc.registerFile(NB, 'a.md');
      svc.registerFile(NB, 'b.md');
      svc.replaceAllEdges(NB, [
        edge('a.md', 'b.md'),
        edge('b.md', 'a.md'),
      ]);

      const orphans = svc.getOrphans(NB);
      expect(orphans).toEqual([]);
    });
  });

  describe('getInboundCount', () => {
    it('should return number of inbound edges', () => {
      svc.replaceAllEdges(NB, [
        edge('a.md', 'c.md'),
        edge('b.md', 'c.md'),
        edge('d.md', 'c.md'),
      ]);

      expect(svc.getInboundCount(NB, 'c.md')).toBe(3);
    });

    it('should return 0 for file with no inbound edges', () => {
      expect(svc.getInboundCount(NB, 'nonexistent.md')).toBe(0);
    });
  });

  describe('getEdgesForPersistence / loadEdges', () => {
    it('should round-trip edges', () => {
      const edges = [
        edge('a.md', 'b.md', 'kubernetes', 85),
        edge('b.md', 'a.md', 'kubernetes', 85),
      ];
      svc.replaceAllEdges(NB, edges);

      const persisted = svc.getEdgesForPersistence(NB);
      expect(persisted.length).toBe(2);

      const svc2 = new LinkGraphService();
      svc2.loadEdges(NB, persisted);

      const links = svc2.getLinksForNote(NB, 'a.md');
      expect(links.outbound.length).toBe(1);
      expect(links.outbound[0].notePath).toBe('b.md');
      expect(links.outbound[0].noun).toBe('kubernetes');
      expect(links.outbound[0].count).toBe(85);
    });
  });

  describe('removeGraph', () => {
    it('should clear all state for notebook', () => {
      svc.registerFile(NB, 'a.md');
      svc.replaceAllEdges(NB, [edge('a.md', 'b.md')]);

      svc.removeGraph(NB);

      const links = svc.getLinksForNote(NB, 'a.md');
      expect(links.outbound).toEqual([]);
      expect(svc.getOrphans(NB)).toEqual([]);
    });
  });
});
