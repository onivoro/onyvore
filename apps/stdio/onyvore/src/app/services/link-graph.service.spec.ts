import { LinkGraphService } from './link-graph.service';
import type { Edge } from '@onivoro/isomorphic-onyvore';

const NB = '/notebooks/test';

function implicitEdge(source: string, target: string, noun = 'term', count = 50): Edge {
  return { source, target, type: 'implicit', noun, count };
}

function explicitEdge(source: string, target: string, noun = 'target', count = 100): Edge {
  return { source, target, type: 'explicit', noun, count };
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

  describe('replaceAllImplicitEdges', () => {
    it('should insert all implicit edges and build indexes', () => {
      svc.replaceAllImplicitEdges(NB, [
        implicitEdge('a.md', 'b.md'),
        implicitEdge('b.md', 'a.md'),
        implicitEdge('a.md', 'c.md'),
        implicitEdge('c.md', 'a.md'),
      ]);

      const links = svc.getLinksForNote(NB, 'a.md');
      expect(links.implicitOutbound.length).toBe(2);
      expect(links.implicitInbound.length).toBe(2);
    });

    it('should clear existing implicit edges first', () => {
      svc.replaceAllImplicitEdges(NB, [
        implicitEdge('a.md', 'b.md'),
        implicitEdge('b.md', 'a.md'),
      ]);
      svc.replaceAllImplicitEdges(NB, [
        implicitEdge('x.md', 'y.md'),
        implicitEdge('y.md', 'x.md'),
      ]);

      const linksA = svc.getLinksForNote(NB, 'a.md');
      expect(linksA.implicitOutbound.length).toBe(0);
      expect(linksA.implicitInbound.length).toBe(0);

      const linksX = svc.getLinksForNote(NB, 'x.md');
      expect(linksX.implicitOutbound.length).toBe(1);
    });

    it('should not affect explicit edges', () => {
      // Add an explicit edge first
      svc.replaceExplicitEdgesForFile(NB, 'a.md', [explicitEdge('a.md', 'b.md')]);
      // Replace all implicit edges
      svc.replaceAllImplicitEdges(NB, [implicitEdge('x.md', 'y.md')]);

      // Explicit edge should still exist
      const links = svc.getLinksForNote(NB, 'a.md');
      expect(links.explicitOutbound.length).toBe(1);
      expect(links.explicitOutbound[0].notePath).toBe('b.md');
    });
  });

  describe('replaceImplicitEdgesForFile', () => {
    it('should replace implicit edges for a specific file', () => {
      svc.replaceAllImplicitEdges(NB, [
        implicitEdge('a.md', 'b.md', 'old', 30),
        implicitEdge('b.md', 'a.md', 'old', 30),
        implicitEdge('a.md', 'c.md', 'old', 20),
        implicitEdge('c.md', 'a.md', 'old', 20),
      ]);

      // Replace implicit edges for a.md — now only links to d.md
      svc.replaceImplicitEdgesForFile(NB, 'a.md', [
        implicitEdge('a.md', 'd.md', 'new', 80),
        implicitEdge('d.md', 'a.md', 'new', 80),
      ]);

      const linksA = svc.getLinksForNote(NB, 'a.md');
      expect(linksA.implicitOutbound.length).toBe(1);
      expect(linksA.implicitOutbound[0].notePath).toBe('d.md');
      expect(linksA.implicitInbound.length).toBe(1);
      expect(linksA.implicitInbound[0].notePath).toBe('d.md');

      // Old edges to b.md and c.md should be gone
      const linksB = svc.getLinksForNote(NB, 'b.md');
      expect(linksB.implicitOutbound.length).toBe(0);
      expect(linksB.implicitInbound.length).toBe(0);
    });

    it('should not affect explicit edges for the same file', () => {
      svc.replaceExplicitEdgesForFile(NB, 'a.md', [explicitEdge('a.md', 'b.md')]);
      svc.replaceImplicitEdgesForFile(NB, 'a.md', [implicitEdge('a.md', 'c.md')]);

      const links = svc.getLinksForNote(NB, 'a.md');
      expect(links.explicitOutbound.length).toBe(1);
      expect(links.explicitOutbound[0].notePath).toBe('b.md');
      expect(links.implicitOutbound.length).toBe(1);
      expect(links.implicitOutbound[0].notePath).toBe('c.md');
    });

    it('should handle replacing with empty edges', () => {
      svc.replaceAllImplicitEdges(NB, [
        implicitEdge('a.md', 'b.md'),
        implicitEdge('b.md', 'a.md'),
      ]);

      svc.replaceImplicitEdgesForFile(NB, 'a.md', []);

      const linksA = svc.getLinksForNote(NB, 'a.md');
      expect(linksA.implicitOutbound.length).toBe(0);
      expect(linksA.implicitInbound.length).toBe(0);
    });
  });

  describe('replaceExplicitEdgesForFile', () => {
    it('should insert explicit outbound edges', () => {
      svc.replaceExplicitEdgesForFile(NB, 'a.md', [
        explicitEdge('a.md', 'b.md', 'B'),
        explicitEdge('a.md', 'c.md', 'C'),
      ]);

      const links = svc.getLinksForNote(NB, 'a.md');
      expect(links.explicitOutbound.length).toBe(2);
    });

    it('should create inbound explicit links on the target', () => {
      svc.replaceExplicitEdgesForFile(NB, 'a.md', [explicitEdge('a.md', 'b.md', 'B')]);

      const linksB = svc.getLinksForNote(NB, 'b.md');
      expect(linksB.explicitInbound.length).toBe(1);
      expect(linksB.explicitInbound[0].notePath).toBe('a.md');
    });

    it('should replace only outbound explicit edges (directional)', () => {
      svc.replaceExplicitEdgesForFile(NB, 'a.md', [explicitEdge('a.md', 'b.md', 'old')]);
      svc.replaceExplicitEdgesForFile(NB, 'a.md', [explicitEdge('a.md', 'c.md', 'new')]);

      const links = svc.getLinksForNote(NB, 'a.md');
      expect(links.explicitOutbound.length).toBe(1);
      expect(links.explicitOutbound[0].notePath).toBe('c.md');
    });

    it('should not affect implicit edges', () => {
      svc.replaceImplicitEdgesForFile(NB, 'a.md', [
        implicitEdge('a.md', 'b.md'),
        implicitEdge('b.md', 'a.md'),
      ]);
      svc.replaceExplicitEdgesForFile(NB, 'a.md', [explicitEdge('a.md', 'c.md')]);

      const links = svc.getLinksForNote(NB, 'a.md');
      expect(links.implicitOutbound.length).toBe(1);
      expect(links.implicitOutbound[0].notePath).toBe('b.md');
      expect(links.explicitOutbound.length).toBe(1);
      expect(links.explicitOutbound[0].notePath).toBe('c.md');
    });
  });

  describe('coexistence of implicit and explicit edges', () => {
    it('should allow both edge types between the same files', () => {
      svc.replaceImplicitEdgesForFile(NB, 'a.md', [
        implicitEdge('a.md', 'b.md', 'kubernetes', 75),
        implicitEdge('b.md', 'a.md', 'kubernetes', 75),
      ]);
      svc.replaceExplicitEdgesForFile(NB, 'a.md', [
        explicitEdge('a.md', 'b.md', 'B'),
      ]);

      const links = svc.getLinksForNote(NB, 'a.md');
      expect(links.implicitOutbound.length).toBe(1);
      expect(links.explicitOutbound.length).toBe(1);
      expect(links.implicitOutbound[0].notePath).toBe('b.md');
      expect(links.explicitOutbound[0].notePath).toBe('b.md');
    });
  });

  describe('removeAllEdgesForFile', () => {
    it('should remove all edges involving the file (both types)', () => {
      svc.replaceImplicitEdgesForFile(NB, 'a.md', [
        implicitEdge('a.md', 'b.md'),
        implicitEdge('b.md', 'a.md'),
      ]);
      svc.replaceExplicitEdgesForFile(NB, 'a.md', [
        explicitEdge('a.md', 'c.md'),
      ]);

      svc.removeAllEdgesForFile(NB, 'a.md');

      const linksA = svc.getLinksForNote(NB, 'a.md');
      expect(linksA.implicitOutbound.length).toBe(0);
      expect(linksA.implicitInbound.length).toBe(0);
      expect(linksA.explicitOutbound.length).toBe(0);
      expect(linksA.explicitInbound.length).toBe(0);

      // b.md and c.md should also lose edges involving a.md
      const linksB = svc.getLinksForNote(NB, 'b.md');
      expect(linksB.implicitOutbound.length).toBe(0);
      const linksC = svc.getLinksForNote(NB, 'c.md');
      expect(linksC.explicitInbound.length).toBe(0);
    });
  });

  describe('getLinksForNote', () => {
    it('should sort implicit links by count descending', () => {
      svc.replaceAllImplicitEdges(NB, [
        implicitEdge('a.md', 'b.md', 'low', 20),
        implicitEdge('a.md', 'c.md', 'high', 90),
        implicitEdge('a.md', 'd.md', 'mid', 50),
      ]);

      const links = svc.getLinksForNote(NB, 'a.md');
      expect(links.implicitOutbound[0].count).toBe(90);
      expect(links.implicitOutbound[1].count).toBe(50);
      expect(links.implicitOutbound[2].count).toBe(20);
    });

    it('should sort explicit links alphabetically by title', () => {
      svc.replaceExplicitEdgesForFile(NB, 'a.md', [
        explicitEdge('a.md', 'zebra.md', 'zebra'),
        explicitEdge('a.md', 'alpha.md', 'alpha'),
        explicitEdge('a.md', 'middle.md', 'middle'),
      ]);

      const links = svc.getLinksForNote(NB, 'a.md');
      expect(links.explicitOutbound[0].noteTitle).toBe('alpha');
      expect(links.explicitOutbound[1].noteTitle).toBe('middle');
      expect(links.explicitOutbound[2].noteTitle).toBe('zebra');
    });

    it('should return empty arrays for unknown notebook', () => {
      const links = svc.getLinksForNote('unknown', 'a.md');
      expect(links.explicitOutbound).toEqual([]);
      expect(links.explicitInbound).toEqual([]);
      expect(links.implicitOutbound).toEqual([]);
      expect(links.implicitInbound).toEqual([]);
    });

    it('should populate noteTitle from file path', () => {
      svc.replaceAllImplicitEdges(NB, [
        implicitEdge('a.md', 'docs/readme.md', 'term', 50),
      ]);

      const links = svc.getLinksForNote(NB, 'a.md');
      expect(links.implicitOutbound[0].noteTitle).toBe('readme');
    });

    it('should include displayText for explicit edges', () => {
      svc.replaceExplicitEdgesForFile(NB, 'a.md', [
        { source: 'a.md', target: 'b.md', type: 'explicit', noun: 'B', displayText: 'Custom Label', count: 100 },
      ]);

      const links = svc.getLinksForNote(NB, 'a.md');
      expect(links.explicitOutbound[0].displayText).toBe('Custom Label');
    });
  });

  describe('getOrphans', () => {
    it('should return files with no edges', () => {
      svc.registerFile(NB, 'a.md');
      svc.registerFile(NB, 'b.md');
      svc.registerFile(NB, 'c.md');

      svc.replaceAllImplicitEdges(NB, [
        implicitEdge('a.md', 'b.md'),
        implicitEdge('b.md', 'a.md'),
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

    it('should not count file as orphan if it has explicit edges', () => {
      svc.registerFile(NB, 'a.md');
      svc.registerFile(NB, 'b.md');
      svc.replaceExplicitEdgesForFile(NB, 'a.md', [explicitEdge('a.md', 'b.md')]);

      const orphans = svc.getOrphans(NB);
      expect(orphans).toEqual([]);
    });
  });

  describe('getInboundCount', () => {
    it('should return number of inbound edges', () => {
      svc.replaceAllImplicitEdges(NB, [
        implicitEdge('a.md', 'c.md'),
        implicitEdge('b.md', 'c.md'),
        implicitEdge('d.md', 'c.md'),
      ]);

      expect(svc.getInboundCount(NB, 'c.md')).toBe(3);
    });

    it('should count both edge types', () => {
      svc.replaceImplicitEdgesForFile(NB, 'a.md', [implicitEdge('a.md', 'c.md')]);
      svc.replaceExplicitEdgesForFile(NB, 'b.md', [explicitEdge('b.md', 'c.md')]);

      expect(svc.getInboundCount(NB, 'c.md')).toBe(2);
    });

    it('should return 0 for file with no inbound edges', () => {
      expect(svc.getInboundCount(NB, 'nonexistent.md')).toBe(0);
    });
  });

  describe('getEdgesForPersistence / loadEdges', () => {
    it('should round-trip implicit edges', () => {
      const edges = [
        implicitEdge('a.md', 'b.md', 'kubernetes', 85),
        implicitEdge('b.md', 'a.md', 'kubernetes', 85),
      ];
      svc.replaceAllImplicitEdges(NB, edges);

      const persisted = svc.getEdgesForPersistence(NB);
      expect(persisted.length).toBe(2);

      const svc2 = new LinkGraphService();
      svc2.loadEdges(NB, persisted);

      const links = svc2.getLinksForNote(NB, 'a.md');
      expect(links.implicitOutbound.length).toBe(1);
      expect(links.implicitOutbound[0].notePath).toBe('b.md');
      expect(links.implicitOutbound[0].noun).toBe('kubernetes');
      expect(links.implicitOutbound[0].count).toBe(85);
    });

    it('should round-trip explicit edges', () => {
      svc.replaceExplicitEdgesForFile(NB, 'a.md', [
        { source: 'a.md', target: 'b.md', type: 'explicit', noun: 'B', displayText: 'My Link', count: 100 },
      ]);

      const persisted = svc.getEdgesForPersistence(NB);
      const svc2 = new LinkGraphService();
      svc2.loadEdges(NB, persisted);

      const links = svc2.getLinksForNote(NB, 'a.md');
      expect(links.explicitOutbound.length).toBe(1);
      expect(links.explicitOutbound[0].displayText).toBe('My Link');
    });

    it('should handle backward compat for edges without type', () => {
      const legacyEdges = [
        { source: 'a.md', target: 'b.md', noun: 'term', count: 50 } as Edge,
      ];

      svc.loadEdges(NB, legacyEdges);

      const links = svc.getLinksForNote(NB, 'a.md');
      expect(links.implicitOutbound.length).toBe(1);
    });
  });

  describe('removeGraph', () => {
    it('should clear all state for notebook', () => {
      svc.registerFile(NB, 'a.md');
      svc.replaceAllImplicitEdges(NB, [implicitEdge('a.md', 'b.md')]);
      svc.replaceExplicitEdgesForFile(NB, 'a.md', [explicitEdge('a.md', 'c.md')]);

      svc.removeGraph(NB);

      const links = svc.getLinksForNote(NB, 'a.md');
      expect(links.implicitOutbound).toEqual([]);
      expect(links.explicitOutbound).toEqual([]);
      expect(svc.getOrphans(NB)).toEqual([]);
    });
  });
});
