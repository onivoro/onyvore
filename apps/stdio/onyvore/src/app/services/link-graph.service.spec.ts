import { LinkGraphService } from './link-graph.service';
import type { Edge } from '@onivoro/isomorphic-onyvore';

const NB = '/notebooks/test';

function similar(source: string, target: string, noun = 'shared', count = 50): Edge {
  return { source, target, type: 'similar', noun, count };
}

function mention(source: string, target: string, noun = 'topic', count = 3): Edge {
  return { source, target, type: 'mention', noun, count };
}

function explicit(
  source: string,
  target: string,
  noun = 'target',
  displayText?: string,
): Edge {
  return { source, target, type: 'explicit', noun, displayText, count: 100 };
}

/** `similar` edges are symmetric and always stored in both directions. */
function similarPair(a: string, b: string, noun = 'shared', count = 50): Edge[] {
  return [similar(a, b, noun, count), similar(b, a, noun, count)];
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
      expect(svc.getOrphans(NB).sort()).toEqual(['a.md', 'b.md']);
    });

    it('should remove file on unregister', () => {
      svc.registerFile(NB, 'a.md');
      svc.registerFile(NB, 'b.md');
      svc.unregisterFile(NB, 'a.md');
      expect(svc.getOrphans(NB)).toEqual(['b.md']);
    });
  });

  describe('replaceAllEdgesOfType', () => {
    it('should insert all edges of the type and build indexes', () => {
      svc.replaceAllEdgesOfType(NB, 'similar', similarPair('a.md', 'b.md'));

      expect(svc.getLinksForNote(NB, 'a.md').similar.map((l) => l.notePath)).toEqual([
        'b.md',
      ]);
      expect(svc.getLinksForNote(NB, 'b.md').similar.map((l) => l.notePath)).toEqual([
        'a.md',
      ]);
    });

    it('should clear existing edges of that type first', () => {
      svc.replaceAllEdgesOfType(NB, 'similar', similarPair('a.md', 'b.md'));
      svc.replaceAllEdgesOfType(NB, 'similar', similarPair('c.md', 'd.md'));

      expect(svc.getLinksForNote(NB, 'a.md').similar).toEqual([]);
      expect(svc.getLinksForNote(NB, 'c.md').similar.map((l) => l.notePath)).toEqual([
        'd.md',
      ]);
    });

    it('should leave other edge types untouched', () => {
      svc.replaceOutboundEdgesForFile(NB, 'a.md', 'explicit', [explicit('a.md', 'b.md')]);
      svc.replaceOutboundEdgesForFile(NB, 'a.md', 'mention', [mention('a.md', 'c.md')]);

      svc.replaceAllEdgesOfType(NB, 'similar', similarPair('x.md', 'y.md'));

      const links = svc.getLinksForNote(NB, 'a.md');
      expect(links.explicitOutbound.map((l) => l.notePath)).toEqual(['b.md']);
      expect(links.mentionOutbound.map((l) => l.notePath)).toEqual(['c.md']);
    });
  });

  describe('replaceSymmetricEdgesForFile', () => {
    it('should replace edges in both directions for the file', () => {
      svc.replaceAllEdgesOfType(NB, 'similar', [
        ...similarPair('a.md', 'b.md'),
        ...similarPair('a.md', 'c.md'),
      ]);

      svc.replaceSymmetricEdgesForFile(NB, 'a.md', 'similar', similarPair('a.md', 'd.md'));

      expect(svc.getLinksForNote(NB, 'a.md').similar.map((l) => l.notePath)).toEqual([
        'd.md',
      ]);
      // The reverse half of the old pairs must go too, not just the outbound half.
      expect(svc.getLinksForNote(NB, 'b.md').similar).toEqual([]);
      expect(svc.getLinksForNote(NB, 'c.md').similar).toEqual([]);
    });

    it('should not affect other edge types for the same file', () => {
      svc.replaceOutboundEdgesForFile(NB, 'a.md', 'explicit', [explicit('a.md', 'b.md')]);
      svc.replaceSymmetricEdgesForFile(NB, 'a.md', 'similar', similarPair('a.md', 'c.md'));

      const links = svc.getLinksForNote(NB, 'a.md');
      expect(links.explicitOutbound.map((l) => l.notePath)).toEqual(['b.md']);
      expect(links.similar.map((l) => l.notePath)).toEqual(['c.md']);
    });

    it('should handle replacing with an empty edge set', () => {
      svc.replaceAllEdgesOfType(NB, 'similar', similarPair('a.md', 'b.md'));
      svc.replaceSymmetricEdgesForFile(NB, 'a.md', 'similar', []);

      expect(svc.getLinksForNote(NB, 'a.md').similar).toEqual([]);
      expect(svc.getLinksForNote(NB, 'b.md').similar).toEqual([]);
    });
  });

  describe('replaceOutboundEdgesForFile', () => {
    it('should insert outbound edges', () => {
      svc.replaceOutboundEdgesForFile(NB, 'a.md', 'explicit', [
        explicit('a.md', 'b.md'),
        explicit('a.md', 'c.md'),
      ]);

      const links = svc.getLinksForNote(NB, 'a.md');
      expect(links.explicitOutbound.map((l) => l.notePath).sort()).toEqual([
        'b.md',
        'c.md',
      ]);
    });

    it('should create the matching inbound link on the target', () => {
      svc.replaceOutboundEdgesForFile(NB, 'a.md', 'explicit', [explicit('a.md', 'b.md')]);

      expect(
        svc.getLinksForNote(NB, 'b.md').explicitInbound.map((l) => l.notePath),
      ).toEqual(['a.md']);
    });

    it('should replace only outbound edges, leaving inbound intact', () => {
      svc.replaceOutboundEdgesForFile(NB, 'a.md', 'explicit', [explicit('a.md', 'b.md')]);
      svc.replaceOutboundEdgesForFile(NB, 'c.md', 'explicit', [explicit('c.md', 'a.md')]);

      svc.replaceOutboundEdgesForFile(NB, 'a.md', 'explicit', []);

      const links = svc.getLinksForNote(NB, 'a.md');
      expect(links.explicitOutbound).toEqual([]);
      expect(links.explicitInbound.map((l) => l.notePath)).toEqual(['c.md']);
    });

    it('should keep mention and explicit edges independent', () => {
      svc.replaceOutboundEdgesForFile(NB, 'a.md', 'explicit', [explicit('a.md', 'b.md')]);
      svc.replaceOutboundEdgesForFile(NB, 'a.md', 'mention', [mention('a.md', 'b.md')]);

      svc.replaceOutboundEdgesForFile(NB, 'a.md', 'mention', []);

      const links = svc.getLinksForNote(NB, 'a.md');
      expect(links.explicitOutbound.map((l) => l.notePath)).toEqual(['b.md']);
      expect(links.mentionOutbound).toEqual([]);
    });
  });

  describe('replaceInboundEdgesForFile', () => {
    it('should attach inbound edges from other notes', () => {
      svc.replaceInboundEdgesForFile(NB, 'new.md', 'mention', [
        mention('a.md', 'new.md'),
        mention('b.md', 'new.md'),
      ]);

      expect(
        svc.getLinksForNote(NB, 'new.md').mentionInbound.map((l) => l.notePath).sort(),
      ).toEqual(['a.md', 'b.md']);
      // And the sources see the corresponding outbound edge.
      expect(
        svc.getLinksForNote(NB, 'a.md').mentionOutbound.map((l) => l.notePath),
      ).toEqual(['new.md']);
    });

    it('should not disturb the target’s outbound edges', () => {
      svc.replaceOutboundEdgesForFile(NB, 'new.md', 'mention', [
        mention('new.md', 'other.md'),
      ]);
      svc.replaceInboundEdgesForFile(NB, 'new.md', 'mention', [
        mention('a.md', 'new.md'),
      ]);

      const links = svc.getLinksForNote(NB, 'new.md');
      expect(links.mentionOutbound.map((l) => l.notePath)).toEqual(['other.md']);
      expect(links.mentionInbound.map((l) => l.notePath)).toEqual(['a.md']);
    });
  });

  describe('coexistence of edge types', () => {
    it('should allow all three types between the same pair of files', () => {
      svc.replaceOutboundEdgesForFile(NB, 'a.md', 'explicit', [explicit('a.md', 'b.md')]);
      svc.replaceOutboundEdgesForFile(NB, 'a.md', 'mention', [mention('a.md', 'b.md')]);
      svc.replaceSymmetricEdgesForFile(NB, 'a.md', 'similar', similarPair('a.md', 'b.md'));

      const links = svc.getLinksForNote(NB, 'a.md');
      expect(links.explicitOutbound.map((l) => l.notePath)).toEqual(['b.md']);
      expect(links.mentionOutbound.map((l) => l.notePath)).toEqual(['b.md']);
      expect(links.similar.map((l) => l.notePath)).toEqual(['b.md']);
    });
  });

  describe('removeAllEdgesForFile', () => {
    it('should remove every edge involving the file, of any type', () => {
      svc.replaceOutboundEdgesForFile(NB, 'a.md', 'explicit', [explicit('a.md', 'b.md')]);
      svc.replaceOutboundEdgesForFile(NB, 'c.md', 'mention', [mention('c.md', 'a.md')]);
      svc.replaceSymmetricEdgesForFile(NB, 'a.md', 'similar', similarPair('a.md', 'd.md'));

      svc.removeAllEdgesForFile(NB, 'a.md');

      const links = svc.getLinksForNote(NB, 'a.md');
      expect(links.explicitOutbound).toEqual([]);
      expect(links.mentionInbound).toEqual([]);
      expect(links.similar).toEqual([]);
      // Dangling edges are pruned from the other side too.
      expect(svc.getLinksForNote(NB, 'b.md').explicitInbound).toEqual([]);
      expect(svc.getLinksForNote(NB, 'c.md').mentionOutbound).toEqual([]);
      expect(svc.getLinksForNote(NB, 'd.md').similar).toEqual([]);
    });
  });

  describe('getLinksForNote', () => {
    it('should sort similar links by count descending', () => {
      svc.replaceAllEdgesOfType(NB, 'similar', [
        ...similarPair('a.md', 'low.md', 'x', 20),
        ...similarPair('a.md', 'high.md', 'y', 80),
      ]);

      expect(svc.getLinksForNote(NB, 'a.md').similar.map((l) => l.notePath)).toEqual([
        'high.md',
        'low.md',
      ]);
    });

    it('should sort mention links by count descending', () => {
      svc.replaceOutboundEdgesForFile(NB, 'a.md', 'mention', [
        mention('a.md', 'few.md', 'few', 1),
        mention('a.md', 'many.md', 'many', 9),
      ]);

      expect(
        svc.getLinksForNote(NB, 'a.md').mentionOutbound.map((l) => l.notePath),
      ).toEqual(['many.md', 'few.md']);
    });

    it('should sort explicit links alphabetically by title', () => {
      svc.replaceOutboundEdgesForFile(NB, 'a.md', 'explicit', [
        explicit('a.md', 'zebra.md'),
        explicit('a.md', 'apple.md'),
      ]);

      expect(
        svc.getLinksForNote(NB, 'a.md').explicitOutbound.map((l) => l.notePath),
      ).toEqual(['apple.md', 'zebra.md']);
    });

    it('should report a similar note once, not as both outbound and inbound', () => {
      svc.replaceAllEdgesOfType(NB, 'similar', similarPair('a.md', 'b.md'));

      const links = svc.getLinksForNote(NB, 'a.md');
      expect(links.similar.map((l) => l.notePath)).toEqual(['b.md']);
    });

    it('should return empty buckets for an unknown notebook', () => {
      const links = svc.getLinksForNote('/nope', 'a.md');
      expect(links).toEqual({
        notePath: 'a.md',
        explicitOutbound: [],
        explicitInbound: [],
        mentionOutbound: [],
        mentionInbound: [],
        similar: [],
      });
    });

    it('should populate noteTitle from the file path', () => {
      svc.replaceOutboundEdgesForFile(NB, 'a.md', 'explicit', [
        explicit('a.md', 'work/My Note.md'),
      ]);

      expect(svc.getLinksForNote(NB, 'a.md').explicitOutbound[0].noteTitle).toBe(
        'my note',
      );
    });

    it('should include displayText for explicit edges', () => {
      svc.replaceOutboundEdgesForFile(NB, 'a.md', 'explicit', [
        explicit('a.md', 'b.md', 'b', 'the other note'),
      ]);

      expect(svc.getLinksForNote(NB, 'a.md').explicitOutbound[0].displayText).toBe(
        'the other note',
      );
    });
  });

  describe('getOrphans', () => {
    it('should return files with no edges', () => {
      svc.registerFile(NB, 'a.md');
      svc.registerFile(NB, 'orphan.md');
      svc.replaceOutboundEdgesForFile(NB, 'a.md', 'explicit', [explicit('a.md', 'b.md')]);

      expect(svc.getOrphans(NB)).toEqual(['orphan.md']);
    });

    it('should return all files when no edges exist', () => {
      svc.registerFile(NB, 'a.md');
      svc.registerFile(NB, 'b.md');
      expect(svc.getOrphans(NB).sort()).toEqual(['a.md', 'b.md']);
    });

    it('should not count a file with explicit edges as an orphan', () => {
      svc.registerFile(NB, 'a.md');
      svc.replaceInboundEdgesForFile(NB, 'a.md', 'explicit', [explicit('b.md', 'a.md')]);
      expect(svc.getOrphans(NB)).toEqual([]);
    });

    it('should not count a file with mention edges as an orphan', () => {
      svc.registerFile(NB, 'a.md');
      svc.replaceOutboundEdgesForFile(NB, 'a.md', 'mention', [mention('a.md', 'b.md')]);
      expect(svc.getOrphans(NB)).toEqual([]);
    });

    it('should still count a file as an orphan when it only has similar edges', () => {
      // Cosine similarity connects nearly every note to something, so counting
      // it would make this list permanently empty.
      svc.registerFile(NB, 'a.md');
      svc.replaceSymmetricEdgesForFile(NB, 'a.md', 'similar', similarPair('a.md', 'b.md'));

      expect(svc.getOrphans(NB)).toEqual(['a.md']);
    });
  });

  describe('getInboundCount', () => {
    it('should return the number of inbound edges', () => {
      svc.replaceInboundEdgesForFile(NB, 'a.md', 'explicit', [
        explicit('b.md', 'a.md'),
        explicit('c.md', 'a.md'),
      ]);
      expect(svc.getInboundCount(NB, 'a.md')).toBe(2);
    });

    it('should count every edge type', () => {
      svc.replaceInboundEdgesForFile(NB, 'a.md', 'explicit', [explicit('b.md', 'a.md')]);
      svc.replaceInboundEdgesForFile(NB, 'a.md', 'mention', [mention('c.md', 'a.md')]);
      svc.replaceSymmetricEdgesForFile(NB, 'a.md', 'similar', similarPair('a.md', 'd.md'));

      expect(svc.getInboundCount(NB, 'a.md')).toBe(3);
    });

    it('should return 0 for a file with no inbound edges', () => {
      expect(svc.getInboundCount(NB, 'nothing.md')).toBe(0);
    });
  });

  describe('getEdgesForPersistence / loadEdges', () => {
    it('should round-trip every edge type', () => {
      svc.replaceOutboundEdgesForFile(NB, 'a.md', 'explicit', [
        explicit('a.md', 'b.md', 'b', 'display'),
      ]);
      svc.replaceOutboundEdgesForFile(NB, 'a.md', 'mention', [
        mention('a.md', 'c.md', 'topic', 7),
      ]);
      svc.replaceSymmetricEdgesForFile(NB, 'a.md', 'similar', similarPair('a.md', 'd.md'));

      const edges = svc.getEdgesForPersistence(NB);

      const restored = new LinkGraphService();
      restored.loadEdges(NB, edges);

      const links = restored.getLinksForNote(NB, 'a.md');
      expect(links.explicitOutbound[0]).toMatchObject({
        notePath: 'b.md',
        displayText: 'display',
      });
      expect(links.mentionOutbound[0]).toMatchObject({ notePath: 'c.md', count: 7 });
      expect(links.similar.map((l) => l.notePath)).toEqual(['d.md']);
    });

    it('should skip persisted edges with an unrecognized type', () => {
      const restored = new LinkGraphService();
      restored.loadEdges(NB, [
        { source: 'a.md', target: 'b.md', noun: 'x', count: 1 } as unknown as Edge,
        { source: 'a.md', target: 'c.md', type: 'implicit', noun: 'x', count: 1 } as unknown as Edge,
        explicit('a.md', 'd.md'),
      ]);

      const links = restored.getLinksForNote(NB, 'a.md');
      expect(links.explicitOutbound.map((l) => l.notePath)).toEqual(['d.md']);
      expect(links.mentionOutbound).toEqual([]);
      expect(links.similar).toEqual([]);
    });
  });

  describe('removeGraph', () => {
    it('should clear all state for the notebook', () => {
      svc.registerFile(NB, 'a.md');
      svc.replaceOutboundEdgesForFile(NB, 'a.md', 'explicit', [explicit('a.md', 'b.md')]);

      svc.removeGraph(NB);

      expect(svc.getOrphans(NB)).toEqual([]);
      expect(svc.getEdgesForPersistence(NB)).toEqual([]);
      expect(svc.getLinksForNote(NB, 'a.md').explicitOutbound).toEqual([]);
    });
  });
});

describe('LinkGraphService — getGraph', () => {
  let svc: LinkGraphService;

  beforeEach(() => {
    svc = new LinkGraphService();
  });

  it('should report every registered note as a node', () => {
    svc.registerFile(NB, 'a.md');
    svc.registerFile(NB, 'work/b.md');

    const graph = svc.getGraph(NB);

    expect(graph.nodes.map((n) => n.relativePath).sort()).toEqual([
      'a.md',
      'work/b.md',
    ]);
    expect(graph.nodes.find((n) => n.relativePath === 'work/b.md')?.title).toBe('b');
    expect(graph.truncated).toBe(0);
  });

  it('should emit one line per similar pair, not two', () => {
    svc.registerFile(NB, 'a.md');
    svc.registerFile(NB, 'b.md');
    svc.replaceAllEdgesOfType(NB, 'similar', similarPair('a.md', 'b.md'));

    expect(svc.getGraph(NB).edges).toHaveLength(1);
  });

  it('should keep both directions for directional edge types', () => {
    svc.registerFile(NB, 'a.md');
    svc.registerFile(NB, 'b.md');
    svc.replaceOutboundEdgesForFile(NB, 'a.md', 'mention', [mention('a.md', 'b.md')]);
    svc.replaceOutboundEdgesForFile(NB, 'b.md', 'mention', [mention('b.md', 'a.md')]);

    expect(svc.getGraph(NB).edges).toHaveLength(2);
  });

  it('should count degree from linking edges only', () => {
    svc.registerFile(NB, 'a.md');
    svc.registerFile(NB, 'b.md');
    svc.replaceOutboundEdgesForFile(NB, 'a.md', 'mention', [mention('a.md', 'b.md')]);
    svc.replaceSymmetricEdgesForFile(NB, 'a.md', 'similar', similarPair('a.md', 'b.md'));

    const node = svc.getGraph(NB).nodes.find((n) => n.relativePath === 'a.md');
    expect(node?.degree).toBe(1);
    expect(node?.orphan).toBe(false);
  });

  it('should mark a note with only similar edges as an orphan', () => {
    svc.registerFile(NB, 'a.md');
    svc.replaceSymmetricEdgesForFile(NB, 'a.md', 'similar', similarPair('a.md', 'b.md'));

    expect(svc.getGraph(NB).nodes[0].orphan).toBe(true);
  });

  it('should keep the best-connected notes when over the cap', () => {
    for (const name of ['hub', 'a', 'b', 'c']) svc.registerFile(NB, `${name}.md`);
    svc.replaceOutboundEdgesForFile(NB, 'hub.md', 'mention', [
      mention('hub.md', 'a.md'),
      mention('hub.md', 'b.md'),
    ]);

    const graph = svc.getGraph(NB, 2);

    expect(graph.nodes).toHaveLength(2);
    expect(graph.nodes.map((n) => n.relativePath)).toContain('hub.md');
    expect(graph.truncated).toBe(2);
  });

  it('should drop edges whose endpoints were cut', () => {
    for (const name of ['hub', 'a', 'b', 'c']) svc.registerFile(NB, `${name}.md`);
    svc.replaceOutboundEdgesForFile(NB, 'hub.md', 'mention', [
      mention('hub.md', 'a.md'),
      mention('hub.md', 'b.md'),
    ]);

    const graph = svc.getGraph(NB, 2);
    const visible = new Set(graph.nodes.map((n) => n.relativePath));

    for (const edge of graph.edges) {
      expect(visible.has(edge.source)).toBe(true);
      expect(visible.has(edge.target)).toBe(true);
    }
  });

  it('should return an empty graph for an unknown notebook', () => {
    expect(svc.getGraph('/nope')).toEqual({
      notebookId: '/nope',
      nodes: [],
      edges: [],
      truncated: 0,
    });
  });
});
